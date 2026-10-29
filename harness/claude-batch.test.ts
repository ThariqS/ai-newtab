/**
 * The Claude engine's Message Batches mode against a scripted stand-in for
 * `client.messages.batches`: every turn is a one-request batch, polled until it
 * ends, with the tools run locally in between.
 */
import { describe, expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import {
  CLAUDE_BATCH_STORAGE_KEYS,
  OUTPUT_PATH,
  runHomepageBuild,
  type BrowserBridge,
  type ClaudeBatchCheckpoint,
} from "@homepage/agent-core";
import { memoryStore } from "./fake-openai";
import { fixtureHistory } from "./node-bridge";

const COMPONENT = `import React from 'react';\nexport default function PersonalizedHomepage() { return <a href="https://news.ycombinator.com/">HN</a>; }`;

let historyCalls = 0;
const bridge: BrowserBridge = {
  getHistory: async () => {
    historyCalls++;
    return { sites: fixtureHistory(), totalSitesSeen: fixtureHistory().length };
  },
  getPageHtml: async ({ urls }) => ({
    pages: urls.map((url) => ({ url, finalUrl: url, title: "Hacker News", html: `<h1>Hacker News</h1>\n<a href="https://example.org/story/1">First story</a>` })),
    failed: [],
  }),
};

type Turn =
  | { content: Anthropic.ContentBlock[]; stop_reason?: Anthropic.StopReason }
  | { errored: Anthropic.ErrorType }
  | { expired: true };

let blockId = 0;
const toolUse = (name: string, input: Record<string, unknown>): Anthropic.ToolUseBlock =>
  ({ type: "tool_use", id: `toolu_${++blockId}`, name, input, caller: { type: "direct" } }) as unknown as Anthropic.ToolUseBlock;
const thinking = (): Anthropic.ContentBlock =>
  ({ type: "thinking", thinking: "", signature: `sig_${++blockId}` }) as unknown as Anthropic.ContentBlock;
const text = (t: string): Anthropic.ContentBlock => ({ type: "text", text: t, citations: null }) as unknown as Anthropic.ContentBlock;

function asResult(turn: Turn): Anthropic.Messages.MessageBatchResult {
  if ("errored" in turn) {
    return { type: "errored", error: { type: "error", request_id: null, error: { type: turn.errored, message: "boom" } } } as Anthropic.Messages.MessageBatchResult;
  }
  if ("expired" in turn) return { type: "expired" };
  return {
    type: "succeeded",
    message: {
      id: `msg_${++blockId}`,
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5-5",
      content: turn.content,
      stop_reason: turn.stop_reason ?? (turn.content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn"),
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 },
    } as unknown as Anthropic.Message,
  };
}

/** A fake `client.messages.batches`. Each create() consumes the next scripted turn. */
function fakeBatches(
  turns: Array<(params: Anthropic.MessageCreateParamsNonStreaming) => Turn>,
  opts: { pollsBeforeEnd?: number; existing?: { id: string; customId: string; turn: Turn } } = {},
) {
  const log = { created: [] as Anthropic.Messages.BatchCreateParams.Request[][], retrieves: 0, cancels: [] as string[] };
  const batches = new Map<string, { customId: string; result: Anthropic.Messages.MessageBatchResult; polls: number }>();
  if (opts.existing) {
    batches.set(opts.existing.id, { customId: opts.existing.customId, result: asResult(opts.existing.turn), polls: 0 });
  }
  const client = {
    messages: {
      batches: {
        create: async ({ requests }: Anthropic.Messages.BatchCreateParams) => {
          log.created.push(JSON.parse(JSON.stringify(requests)));
          const script = turns[log.created.length - 1];
          if (!script) throw new Error(`no scripted turn ${log.created.length - 1}`);
          const id = `msgbatch_${log.created.length}`;
          batches.set(id, { customId: requests[0]!.custom_id, result: asResult(script(requests[0]!.params)), polls: opts.pollsBeforeEnd ?? 1 });
          return { id, processing_status: "in_progress" };
        },
        retrieve: async (id: string) => {
          log.retrieves++;
          const batch = batches.get(id)!;
          return { id, processing_status: batch.polls-- > 0 ? "in_progress" : "ended" };
        },
        results: async (id: string) => {
          const batch = batches.get(id)!;
          return (async function* () {
            yield { custom_id: batch.customId, result: batch.result };
          })();
        },
        cancel: async (id: string) => {
          log.cancels.push(id);
          return { id, processing_status: "canceling" };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, log };
}

const run = (client: Anthropic, store: ReturnType<typeof memoryStore>["store"], extra: Record<string, unknown> = {}) =>
  runHomepageBuild({ engine: "claude", apiMode: "batch", client, bridge, store, model: "claude-sonnet-5-5", pollIntervalsMs: [1], ...extra });

describe("Claude engine through Message Batches", () => {
  test("sends each turn as a one-request batch, reads history up front, stops once the homepage is written", async () => {
    historyCalls = 0;
    const { client, log } = fakeBatches([
      (params) => {
        expect(params.messages).toHaveLength(1);
        const kickoff = params.messages[0]!.content as string;
        expect(kickoff).toContain("getHistory has already been called for you");
        expect(kickoff).toContain('"totalSitesSeen"');
        expect(params.system).toContain("You are an editor");
        expect(params.tools!.map((t) => (t as Anthropic.Tool).name)).toEqual(["getHistory", "getPageHtml", "grep", "read", "glob", "write"]);
        expect(params.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
        expect(params.output_config).toEqual({ effort: "medium" });
        return { content: [thinking(), toolUse("getPageHtml", { urls: ["https://news.ycombinator.com/"] })] };
      },
      (params) => {
        // Append-only: the first turn's request is this one's prefix, thinking block included.
        expect(params.messages).toHaveLength(3);
        expect((params.messages[1]!.content as Anthropic.ContentBlockParam[])[0]!.type).toBe("thinking");
        const results = params.messages[2]!.content as Anthropic.ToolResultBlockParam[];
        expect(results).toHaveLength(1);
        expect(String(results[0]!.content)).toContain("mountPath");
        const mounted = JSON.parse(String(results[0]!.content)).pages[0].mountPath;
        return { content: [toolUse("read", { path: mounted }), toolUse("write", { path: OUTPUT_PATH, content: COMPONENT })] };
      },
    ]);
    const { store, data } = memoryStore();
    const result = await run(client, store);

    expect(result.code).toContain("PersonalizedHomepage");
    expect(result.engine).toBe("claude");
    expect(result.turns).toBe(2);
    expect(log.created).toHaveLength(2); // no third batch just for a closing message
    expect(log.created.every((requests) => requests.length === 1)).toBe(true);
    expect(historyCalls).toBe(1);
    expect(data.has(CLAUDE_BATCH_STORAGE_KEYS.activeBatchBuild)).toBe(false);
  });

  test("polls a queued batch until it ends, reporting the wait", async () => {
    const { client, log } = fakeBatches([() => ({ content: [toolUse("write", { path: OUTPUT_PATH, content: COMPONENT })] })], { pollsBeforeEnd: 3 });
    const { store } = memoryStore();
    const details: string[] = [];
    await run(client, store, { callbacks: { onPhase: (_p: string, d?: string) => d && details.push(d) } });
    expect(log.retrieves).toBe(4);
    expect(details.filter((d) => d.startsWith("waiting in the batch queue"))).toHaveLength(3);
  });

  test("checkpoints the batch in flight, and a resume polls that batch instead of submitting another", async () => {
    // First host: submits turn 1, then dies (simulated by cancelling) while it waits.
    const first = fakeBatches([() => ({ content: [toolUse("write", { path: OUTPUT_PATH, content: COMPONENT })] })], { pollsBeforeEnd: 1000 });
    const { store, data } = memoryStore();
    const controller = new AbortController();
    const saved: ClaudeBatchCheckpoint[] = [];
    const watching = { ...store, set: async (k: string, v: unknown) => { if (k === CLAUDE_BATCH_STORAGE_KEYS.activeBatchBuild) saved.push(JSON.parse(JSON.stringify(v))); return store.set(k, v); } };
    setTimeout(() => controller.abort(), 20);
    await expect(run(first.client, watching, { signal: controller.signal })).rejects.toThrow("aborted");
    const inFlight = saved.findLast((c) => c.pending);
    expect(inFlight?.pending?.batchId).toBe("msgbatch_1");
    expect(first.log.cancels).toEqual(["msgbatch_1"]); // a cancelled build doesn't leave its turn in the queue

    // Second host: the same checkpoint, the batch has since ended.
    await store.set(CLAUDE_BATCH_STORAGE_KEYS.activeBatchBuild, inFlight);
    const second = fakeBatches([], {
      existing: { id: "msgbatch_1", customId: inFlight!.pending!.customId, turn: { content: [toolUse("write", { path: OUTPUT_PATH, content: COMPONENT })] } },
    });
    const result = await run(second.client, store, { resume: true });
    expect(second.log.created).toHaveLength(0);
    expect(result.code).toContain("PersonalizedHomepage");
    expect(data.has(CLAUDE_BATCH_STORAGE_KEYS.activeBatchBuild)).toBe(false);
  });

  test("submits a turn again after a server-side error in the queue", async () => {
    const { client, log } = fakeBatches([
      () => ({ errored: "api_error" }),
      () => ({ content: [toolUse("write", { path: OUTPUT_PATH, content: COMPONENT })] }),
    ]);
    const { store } = memoryStore();
    const result = await run(client, store);
    expect(log.created).toHaveLength(2);
    expect(log.created[1]![0]!.params.messages).toEqual(log.created[0]![0]!.params.messages);
    expect(result.turns).toBe(1);
  });

  test("surfaces a request error, a refusal and an expired batch in plain words", async () => {
    const cases: Array<[Turn, RegExp]> = [
      [{ errored: "invalid_request_error" }, /batch request failed \(invalid_request_error\)/],
      [{ content: [text("")], stop_reason: "refusal" }, /Claude declined this build/],
      [{ expired: true }, /did not process this build's turn within 24 hours/],
    ];
    for (const [turn, message] of cases) {
      const { client } = fakeBatches([() => turn]);
      const { store, data } = memoryStore();
      await expect(run(client, store)).rejects.toThrow(message);
      expect(data.has(CLAUDE_BATCH_STORAGE_KEYS.activeBatchBuild)).toBe(false);
    }
  });

  test("asks once for the file when a turn ends without it", async () => {
    const { client, log } = fakeBatches([
      () => ({ content: [text("Here is my plan.")] }),
      (params) => {
        expect(params.messages.at(-1)!.content).toContain(`write the complete component to ${OUTPUT_PATH}`);
        return { content: [toolUse("write", { path: OUTPUT_PATH, content: COMPONENT })] };
      },
    ]);
    const { store } = memoryStore();
    const result = await run(client, store);
    expect(log.created).toHaveLength(2);
    expect(result.code).toContain("PersonalizedHomepage");
  });
});
