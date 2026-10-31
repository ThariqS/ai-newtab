/**
 * A scripted stand-in for api.openai.com, for exercising the agent loop without
 * a network. Each turn receives the parsed /responses body and answers with
 * output items (streamed as SSE the way the real API does), an HTTP error, a
 * mid-stream `response.failed`, or a mid-stream `error` event.
 */
import type { OutputFunctionCall, OutputItem } from "@homepage/agent-core";

export type FakeTurnResult =
  | { output: OutputItem[]; /** Send an empty `output` in response.completed (a slim proxy response). */ slimCompleted?: boolean }
  | { httpStatus: number; error: { code?: string; message?: string; param?: string | null } }
  | { failed: { code: string; message?: string } }
  /** Fields of a mid-stream `{type: "error", …}` event, e.g. `{ error: { type, code, message } }`. */
  | { streamError: Record<string, unknown> };

export type FakeTurn = (body: any, turn: number) => FakeTurnResult;

export interface FakeOpenAI {
  fetch: typeof fetch;
  /** Every /responses body, in order. */
  requests: any[];
  /** Authorization header values seen, in order. */
  tokens: string[];
  /** Token-endpoint refresh calls. */
  refreshes: number;
}

let callCounter = 0;
export function call(name: string, args: Record<string, unknown>, opts: { namespace?: string } = {}): OutputFunctionCall {
  callCounter++;
  return {
    type: "function_call",
    id: `fc_${callCounter}`,
    call_id: `call_${callCounter}`,
    name,
    arguments: JSON.stringify(args),
    ...(opts.namespace ? { namespace: opts.namespace } : {}),
  };
}

export function message(text: string): OutputItem {
  return { type: "message", id: `msg_${++callCounter}`, role: "assistant", content: [{ type: "output_text", text }] };
}

export function reasoning(encrypted?: string): OutputItem {
  return { type: "reasoning", id: `rs_${++callCounter}`, summary: [], encrypted_content: encrypted ?? null };
}

function sse(events: object[]): Response {
  const body = events.map((e) => `event: ${(e as any).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "x-request-id": "req_fake" } });
}

/** The function_call_output items in a request body, as parsed JSON where possible. */
export function outputsIn(body: any): Array<{ call_id: string; output: string }> {
  return (body.input as any[]).filter((i) => i.type === "function_call_output");
}

export function fakeOpenAI(
  turns: FakeTurn[],
  opts: { models?: Array<{ slug: string; display_name: string; visibility: string }>; refresh?: () => object } = {},
): FakeOpenAI {
  const state: FakeOpenAI = { requests: [], tokens: [], refreshes: 0, fetch: undefined as unknown as typeof fetch };
  let turn = 0;

  state.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);

    if (url === "https://auth.openai.com/api/accounts/oauth/token") {
      state.refreshes++;
      return Response.json(
        opts.refresh?.() ?? { access_token: `tok_refreshed_${state.refreshes}`, refresh_token: `rt_${state.refreshes}`, token_type: "Bearer", expires_in: 3600, scope: "openid chatgpt.tokens.use.direct" },
      );
    }
    if (url.endsWith("/models")) {
      state.tokens.push(headers.get("authorization") ?? "");
      return Response.json({ models: opts.models ?? [{ slug: "gpt-test", display_name: "GPT Test", visibility: "list" }] });
    }
    if (!url.endsWith("/responses")) return new Response("not found", { status: 404 });

    const body = JSON.parse(String(init?.body));
    state.requests.push(body);
    state.tokens.push(headers.get("authorization") ?? "");
    const script = turns[turn];
    if (!script) return Response.json({ error: { message: `no scripted turn ${turn}`, code: "fake_exhausted" } }, { status: 500 });
    const result = script(body, turn);
    turn++;

    if ("httpStatus" in result) {
      return Response.json({ error: { type: "invalid_request_error", ...result.error } }, { status: result.httpStatus });
    }
    const id = `resp_${turn}`;
    if ("streamError" in result) {
      return sse([
        { type: "response.created", response: { id, status: "in_progress", output: [] } },
        { type: "response.output_text.delta", delta: "partial " },
        { type: "error", sequence_number: 2, ...result.streamError },
      ]);
    }
    if ("failed" in result) {
      return sse([
        { type: "response.created", response: { id, status: "in_progress", output: [] } },
        { type: "response.output_text.delta", delta: "partial " },
        { type: "response.failed", response: { id, status: "failed", output: [], error: result.failed } },
      ]);
    }
    const events: object[] = [{ type: "response.created", response: { id, status: "in_progress", output: [] } }];
    result.output.forEach((item, i) => {
      events.push({ type: "response.output_item.added", output_index: i, item: { ...item, ...(item.type === "function_call" ? { arguments: "" } : {}) } });
      if (item.type === "message") {
        for (const block of (item as any).content) events.push({ type: "response.output_text.delta", delta: block.text });
      }
      if (item.type === "function_call") {
        events.push({ type: "response.function_call_arguments.done", arguments: (item as any).arguments });
      }
      events.push({ type: "response.output_item.done", output_index: i, item });
    });
    events.push({
      type: "response.completed",
      response: {
        id,
        status: "completed",
        output: result.slimCompleted ? [] : result.output,
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      },
    });
    return sse(events);
  }) as typeof fetch;

  return state;
}

/** A KVStore in memory that also exposes everything written, for assertions. */
export function memoryStore(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initial));
  const writes: Array<[string, unknown]> = [];
  return {
    data,
    writes,
    store: {
      get: async <T,>(key: string) => data.get(key) as T | undefined,
      set: async (key: string, value: unknown) => {
        // Deep-copy so later mutation of live objects doesn't rewrite history.
        const copy = JSON.parse(JSON.stringify(value));
        data.set(key, copy);
        writes.push([key, copy]);
      },
      remove: async (key: string) => {
        data.delete(key);
      },
    },
  };
}

export const staticAuth = (token = "tok_initial") => ({
  calls: [] as Array<{ forceRefresh?: boolean } | undefined>,
  provider: {
    getAccessToken: async function (this: any, opts?: { forceRefresh?: boolean }) {
      return opts?.forceRefresh ? "tok_refreshed" : token;
    },
  },
});
