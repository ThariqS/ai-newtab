/**
 * The Claude engine on the Message Batches API: half the token price, in
 * exchange for latency. A batch request is single-shot, so the agent loop runs
 * here, in the host, and every model turn is submitted as a one-request batch,
 * polled until it ends, then its tool calls run locally against the same
 * in-memory sandbox and browser tools as the OpenAI engine.
 *
 * Managed Agents sessions can't go through batches, so this path talks to the
 * plain Messages API (`client.messages.batches.*`). Each turn can wait in the
 * queue for minutes (most batches end within the hour, the limit is 24 hours),
 * which shapes the loop:
 *
 * - the history digest is read before the first turn and handed to the model,
 *   so it never spends a turn on getHistory;
 * - the kickoff asks for few, wide turns (all independent tool calls at once);
 * - the build ends as soon as the homepage file is written, without another
 *   turn for a closing message;
 * - the conversation, the sandbox and the batch in flight are checkpointed, so
 *   a host that is killed mid-wait picks the same batch up again on resume;
 * - the 1-hour prompt-cache TTL, since turns can be further apart than 5 minutes.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { HOMEPAGE_SYSTEM_PROMPT, OUTPUT_PATH, buildKickoffMessage } from "../prompt";
import { DEFAULT_BLOCKED_SITES, normalizeBlockList } from "../site-filter";
import { collectDeliverable, phaseForTool, runTool, type Emit, type ToolContext } from "../openai/orchestrator";
import { Sandbox, type SandboxSnapshot } from "../openai/sandbox";
import { FUNCTION_TOOLS, isToolName } from "../openai/tools";
import type { HomepageBuildResult } from "../types";
import { DEFAULT_MODEL } from "./setup";
import type { ClaudeRunOptions } from "./orchestrator";

export const CLAUDE_BATCH_STORAGE_KEYS = {
  /** The in-progress batch build (see ClaudeBatchCheckpoint); present means "resumable". */
  activeBatchBuild: "claudeBatchBuild",
} as const;

/** The tools as the Messages API takes them: same names, descriptions and schemas. */
export const ANTHROPIC_TOOLS: Anthropic.Tool[] = FUNCTION_TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.parameters as Anthropic.Tool.InputSchema,
}));

/** Output room for one turn: thinking plus a whole component in one `write`. Batches have no HTTP timeout to respect. */
const MAX_TOKENS = 64_000;
/** Turns, not batches: a safety valve against a model that never writes the file. */
const MAX_TURNS = 16;
/** Polling cadence while a batch waits: quick at first (small batches often end fast), then once a minute. */
export const DEFAULT_POLL_INTERVALS_MS = [5_000, 5_000, 10_000, 15_000, 30_000, 60_000];
/** A turn whose request errored on the server side is submitted again this many times. */
const MAX_RESUBMITS = 2;

export interface ClaudeBatchCheckpoint {
  version: 1;
  buildId: string;
  model: string;
  startedAt: string;
  turn: number;
  messages: Anthropic.MessageParam[];
  sandbox: SandboxSnapshot;
  /** The batch carrying the current turn, while it waits in the queue. */
  pending?: { batchId: string; customId: string; submittedAt: string };
  emptyTurns: number;
  usage: TokenTotals;
}

interface TokenTotals {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

export interface ClaudeBatchRunOptions extends Omit<ClaudeRunOptions, "apiMode" | "resumeSessionId"> {
  apiMode: "batch";
  /** Continue the checkpointed build a previous run left behind (e.g. after the host was killed mid-wait). */
  resume?: boolean;
  /** Injectable for tests. */
  pollIntervalsMs?: number[];
  maxTurns?: number;
}

const BATCH_NOTE = [
  ``,
  `This build runs through a batch queue: each of your turns waits in that queue, often for minutes. Take as few turns as you can.`,
  `- getHistory has already been called for you; its result is below. Do not call it again.`,
  `- Put every independent tool call in the same turn: all the pages in one getPageHtml call, then grep or read all of them in one turn.`,
  `- Small pages can be read whole; grep large ones and read only the matching ranges.`,
  `- Write ${OUTPUT_PATH} as soon as you have what you need. Writing it ends the build: no closing message is needed.`,
].join("\n");

export async function runClaudeBatchBuild(opts: ClaudeBatchRunOptions): Promise<HomepageBuildResult> {
  const { client, bridge, store, callbacks, signal } = opts;
  const emit: Emit = {
    phase: (p, d) => callbacks?.onPhase?.(p, d),
    text: (t) => callbacks?.onText?.(t),
    log: (l) => callbacks?.onLog?.(l),
  };
  const now = opts.now ?? new Date();
  const blockedSites = async () =>
    normalizeBlockList((typeof opts.blockedSites === "function" ? await opts.blockedSites() : opts.blockedSites) ?? DEFAULT_BLOCKED_SITES);
  const pollIntervals = opts.pollIntervalsMs ?? DEFAULT_POLL_INTERVALS_MS;

  emit.phase("setup");
  let checkpoint = opts.resume
    ? await store.get<ClaudeBatchCheckpoint>(CLAUDE_BATCH_STORAGE_KEYS.activeBatchBuild)
    : undefined;
  if (checkpoint && checkpoint.version !== 1) checkpoint = undefined;

  const sandbox = Sandbox.fromSnapshot(checkpoint?.sandbox);
  const toolContext = async (): Promise<ToolContext> => ({ bridge, sandbox, emit, blockedSites: await blockedSites() });

  let state: ClaudeBatchCheckpoint;
  if (checkpoint) {
    state = checkpoint;
    emit.log(
      `resuming ${state.buildId} at turn ${state.turn}` +
        (state.pending ? ` (batch ${state.pending.batchId} still queued)` : ""),
    );
  } else {
    const buildId = `build_${now.toISOString().slice(0, 10)}_${Math.random().toString(36).slice(2, 8)}`;
    const model = opts.model ?? DEFAULT_MODEL;
    emit.log(`build ${buildId} model=${model} via Message Batches`);
    // Read the history now: a getHistory turn would cost a whole queue wait.
    const digest = await runTool("getHistory", {}, await toolContext());
    state = {
      version: 1,
      buildId,
      model,
      startedAt: now.toISOString(),
      turn: 0,
      messages: [
        {
          role: "user",
          content:
            buildKickoffMessage({ now, userSystemPrompt: opts.userSystemPrompt }) +
            "\n" +
            BATCH_NOTE +
            `\n\ngetHistory result:\n\`\`\`json\n${digest}\n\`\`\``,
        },
      ],
      sandbox: sandbox.snapshot(),
      emptyTurns: 0,
      usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
    };
  }

  const save = () =>
    store.set(CLAUDE_BATCH_STORAGE_KEYS.activeBatchBuild, { ...state, sandbox: sandbox.snapshot() } satisfies ClaudeBatchCheckpoint);
  await save();

  let finalText = "";
  try {
    // A host killed while tools were running left tool calls without results.
    const hanging = unansweredToolUses(state.messages);
    if (hanging.length && !state.pending) {
      emit.log(`re-running ${hanging.length} tool call(s) left without results`);
      const done = await runToolUses(hanging, await toolContext(), emit);
      state.messages.push({ role: "user", content: done.results });
      await save();
    }

    const maxTurns = opts.maxTurns ?? MAX_TURNS;
    while (true) {
      if (signal?.aborted) throw new Error("aborted");

      if (!state.pending) {
        if (state.turn >= maxTurns) throw new Error(`Build stopped after ${maxTurns} turns without a finished homepage.`);
        state.turn++;
        state.pending = await submitTurn(client, state, emit);
        await save();
      }

      const message = await awaitTurn(client, state.pending, { emit, signal, pollIntervals });
      if (message === "resubmit") {
        state.pending = undefined;
        state.turn--;
        await save();
        continue;
      }
      state.pending = undefined;
      recordUsage(state.usage, message.usage);
      emit.log(`turn ${state.turn}: ${describeContent(message.content)} · ${describeUsage(message.usage)}`);

      if (message.stop_reason === "refusal") {
        throw new Error(
          `Claude declined this build${message.stop_details?.category ? ` (${message.stop_details.category})` : ""}. ` +
            `Try again, or adjust your standing instructions in Settings.`,
        );
      }
      if (message.stop_reason === "max_tokens") {
        throw new Error("Claude's answer was cut off at the output limit before the homepage was written. Try again.");
      }

      // The model's turn goes back verbatim, thinking blocks included: the history stays append-only.
      state.messages.push({ role: "assistant", content: message.content });
      const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      if (text.trim()) emit.text(text + "\n\n");
      finalText += text;

      const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (toolUses.length === 0) {
        if (!sandbox.outputs().length && !text.includes("PersonalizedHomepage") && state.emptyTurns < 1) {
          state.emptyTurns++;
          emit.log("turn ended without the homepage; asking for it");
          state.messages.push({
            role: "user",
            content: `The build is not finished: write the complete component to ${OUTPUT_PATH} now.`,
          });
          await save();
          continue;
        }
        break;
      }

      const done = await runToolUses(toolUses, await toolContext(), emit);
      if (done.wroteHomepage) {
        // The file is the deliverable; another queued turn would only buy a closing remark.
        emit.log(`homepage written after ${state.turn} turn(s); ${describeTotals(state.usage)}`);
        break;
      }
      state.messages.push({ role: "user", content: done.results });
      await save();
    }

    emit.phase("writing");
    const deliverable = collectDeliverable(sandbox, finalText, emit);
    emit.phase("done");
    return { code: deliverable.code, engine: "claude", id: state.buildId, source: deliverable.source, turns: state.turn };
  } catch (err) {
    if (state.pending && signal?.aborted) {
      // Don't leave a cancelled build's turn running (and billed) in the queue.
      await client.messages.batches.cancel(state.pending.batchId).catch(() => {});
      emit.log(`cancelled batch ${state.pending.batchId}`);
    }
    throw err;
  } finally {
    emit.phase("cleanup");
    await store.remove(CLAUDE_BATCH_STORAGE_KEYS.activeBatchBuild);
  }
}

// ---------------------------------------------------------------------------
// one turn through the batch queue
// ---------------------------------------------------------------------------

async function submitTurn(
  client: Anthropic,
  state: ClaudeBatchCheckpoint,
  emit: Emit,
): Promise<NonNullable<ClaudeBatchCheckpoint["pending"]>> {
  const customId = `${state.buildId}-t${state.turn}`;
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: state.model,
    max_tokens: MAX_TOKENS,
    system: HOMEPAGE_SYSTEM_PROMPT,
    tools: ANTHROPIC_TOOLS,
    messages: state.messages,
    // Each turn re-sends the previous one as its prefix; turns can be more than
    // 5 minutes apart in the queue, so the cache entry has to outlive that.
    cache_control: { type: "ephemeral", ttl: "1h" },
    output_config: { effort: "medium" },
  };
  emit.phase("thinking", "submitting to the batch queue");
  const batch = await client.messages.batches.create({ requests: [{ custom_id: customId, params }] });
  emit.log(`turn ${state.turn}: batch ${batch.id} submitted`);
  return { batchId: batch.id, customId, submittedAt: new Date().toISOString() };
}

/**
 * Poll the turn's batch until it ends, then read its one result. Returns the
 * model's message, or "resubmit" when the server failed the request in a way
 * worth another try.
 */
async function awaitTurn(
  client: Anthropic,
  pending: NonNullable<ClaudeBatchCheckpoint["pending"]>,
  ctx: { emit: Emit; signal?: AbortSignal; pollIntervals: number[] },
): Promise<Anthropic.Message | "resubmit"> {
  const submitted = Date.parse(pending.submittedAt);
  for (let poll = 0; ; poll++) {
    if (ctx.signal?.aborted) throw new Error("aborted");
    const batch = await client.messages.batches.retrieve(pending.batchId);
    if (batch.processing_status === "ended") break;
    ctx.emit.phase("thinking", `waiting in the batch queue · ${elapsed(submitted)}`);
    await sleep(ctx.pollIntervals[Math.min(poll, ctx.pollIntervals.length - 1)] ?? 60_000, ctx.signal);
  }

  let outcome: Anthropic.Messages.MessageBatchResult | undefined;
  for await (const entry of await client.messages.batches.results(pending.batchId)) {
    if (entry.custom_id === pending.customId) outcome = entry.result;
  }
  ctx.emit.log(`batch ${pending.batchId} ended after ${elapsed(submitted)}`);

  switch (outcome?.type) {
    case "succeeded":
      return outcome.message;
    case "errored": {
      const error = outcome.error.error;
      const retryable = error.type === "api_error" || error.type === "overloaded_error" || error.type === "timeout_error";
      const attempts = resubmits.get(pending.customId) ?? 0;
      if (retryable && attempts < MAX_RESUBMITS) {
        resubmits.set(pending.customId, attempts + 1);
        ctx.emit.log(`turn failed in the queue (${error.type}: ${error.message}); submitting it again`);
        return "resubmit";
      }
      throw new Error(`The batch request failed (${error.type}): ${error.message}`);
    }
    case "expired":
      throw new Error("The batch expired: Anthropic's queue did not process this build's turn within 24 hours. Try again later.");
    case "canceled":
      throw new Error("The batch was cancelled before it ran.");
    default:
      throw new Error(`Batch ${pending.batchId} ended without a result for ${pending.customId}.`);
  }
}

/** Resubmission count per turn, for the life of this host (a resume starts over, which is fine). */
const resubmits = new Map<string, number>();

// ---------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------

async function runToolUses(
  toolUses: Anthropic.ToolUseBlock[],
  ctx: ToolContext,
  emit: Emit,
): Promise<{ results: Anthropic.ToolResultBlockParam[]; wroteHomepage: boolean }> {
  const results: Anthropic.ToolResultBlockParam[] = [];
  let wroteHomepage = false;
  // Sequential on purpose: getPageHtml drives real browser tabs, and the sandbox tools are instant.
  for (const use of toolUses) {
    emit.phase(phaseForTool(use.name), use.name);
    emit.log(`tool:${use.name}`);
    try {
      if (!isToolName(use.name)) throw new Error(`Unknown tool: ${use.name}`);
      const args = (use.input && typeof use.input === "object" ? use.input : {}) as Record<string, unknown>;
      const output = await runTool(use.name, args, ctx);
      results.push({ type: "tool_result", tool_use_id: use.id, content: output });
      if (use.name === "write" && ctx.sandbox.outputs().some((f) => f.path === OUTPUT_PATH && f.content.trim())) {
        wroteHomepage = true;
      }
    } catch (err) {
      emit.log(`tool ${use.name} failed: ${String(err)}`);
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
        is_error: true,
      });
    }
  }
  return { results, wroteHomepage };
}

/** tool_use blocks in the last assistant turn that no user turn answered yet. */
export function unansweredToolUses(messages: Anthropic.MessageParam[]): Anthropic.ToolUseBlock[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant" || typeof last.content === "string") return [];
  return last.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function recordUsage(totals: TokenTotals, usage: Anthropic.Usage) {
  totals.input += usage.input_tokens ?? 0;
  totals.cacheRead += usage.cache_read_input_tokens ?? 0;
  totals.cacheWrite += usage.cache_creation_input_tokens ?? 0;
  totals.output += usage.output_tokens ?? 0;
}

function describeUsage(usage: Anthropic.Usage): string {
  return (
    `${usage.input_tokens ?? 0} in` +
    (usage.cache_read_input_tokens ? ` + ${usage.cache_read_input_tokens} cached` : "") +
    (usage.cache_creation_input_tokens ? ` + ${usage.cache_creation_input_tokens} cache-write` : "") +
    ` / ${usage.output_tokens ?? 0} out`
  );
}

function describeTotals(t: TokenTotals): string {
  return `tokens at batch price: ${t.input} in, ${t.cacheRead} cached, ${t.cacheWrite} cache-write, ${t.output} out`;
}

/** `2 block(s): thinking, tool_use getPageHtml` — for the activity log. */
function describeContent(content: Anthropic.ContentBlock[]): string {
  const kinds = content.map((b) => (b.type === "tool_use" ? `tool_use ${b.name}` : b.type));
  return `${content.length} block(s)${kinds.length ? `: ${kinds.join(", ")}` : ""}`;
}

function elapsed(since: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - since) / 1000));
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 90 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
