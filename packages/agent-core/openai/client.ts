/**
 * A deliberately small client for the OpenAI Responses API, written against the
 * Sign in with ChatGPT contract rather than the general API:
 *
 * - every request is `store: false`, `stream: true`, `input` as an array;
 * - no `previous_response_id`: the whole history rides along in `input`;
 * - the unsupported fields (temperature, max_output_tokens, background, …) are
 *   simply never sent;
 * - `response.failed` can arrive mid-stream and carries the plan-usage codes;
 *   an `error` event can too, with its fields nested under `error`.
 *
 * Plain `fetch` + an SSE parser: no SDK, so the extension bundle stays small and
 * every byte sent with the user's token is visible here.
 */

export const OPENAI_API_BASE = "https://api.openai.com/v1";

/**
 * Used only until the model list has been fetched for the credentials in use.
 * The real choices come from `listModels()`; a stored slug that is no longer
 * offered falls back to the first listed model.
 */
export const DEFAULT_OPENAI_MODEL = "gpt-5.5";

// ---------------------------------------------------------------------------
// request / response shapes (the subset this app uses)
// ---------------------------------------------------------------------------

export interface FunctionToolDef {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

export interface NamespaceToolDef {
  type: "namespace";
  name: string;
  description: string;
  tools: FunctionToolDef[];
}

export type ToolDef = FunctionToolDef | NamespaceToolDef;

export type InputContent = { type: "input_text"; text: string };

export type InputItem =
  | { type?: "message"; role: "user" | "developer" | "assistant"; content: string | InputContent[] }
  | { type: "function_call_output"; call_id: string; output: string; name?: string; namespace?: string }
  | { type: "additional_tools"; role: "developer"; tools: ToolDef[] }
  | OutputItem;

export interface OutputMessage {
  type: "message";
  id?: string;
  role: "assistant";
  status?: string;
  content: Array<{ type: "output_text"; text: string; annotations?: unknown[] } | { type: "refusal"; refusal: string }>;
}

export interface OutputFunctionCall {
  type: "function_call";
  id?: string;
  call_id: string;
  name: string;
  namespace?: string;
  arguments: string;
  status?: string;
}

export interface OutputReasoning {
  type: "reasoning";
  id?: string;
  summary?: Array<{ type: "summary_text"; text: string }>;
  encrypted_content?: string | null;
  status?: string;
}

export type OutputItem = OutputMessage | OutputFunctionCall | OutputReasoning | { type: string; [k: string]: unknown };

export interface ResponseError {
  type?: string;
  code?: string | null;
  message?: string;
  param?: string | null;
}

export interface ResponseObject {
  id: string;
  status: "completed" | "failed" | "incomplete" | "in_progress" | string;
  output: OutputItem[];
  error?: ResponseError | null;
  incomplete_details?: { reason?: string } | null;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}

export interface ResponsesRequest {
  model: string;
  instructions?: string;
  input: InputItem[];
  tools?: ToolDef[];
  include?: string[];
  reasoning?: { effort?: "minimal" | "low" | "medium" | "high"; summary?: "auto" | "concise" | "detailed" };
  /** Always `false` under SIWC; present in the type so it is never forgotten. */
  store: false;
  stream: true;
}

/** Streaming events, loosely typed: only the fields this app reads are named. */
export interface StreamEvent {
  type: string;
  sequence_number?: number;
  response?: ResponseObject;
  item?: OutputItem;
  output_index?: number;
  item_id?: string;
  delta?: string;
  text?: string;
  arguments?: string;
  code?: string | null;
  message?: string;
  param?: string | null;
  /** On `error` events the API nests the details here rather than at the top level. */
  error?: ResponseError | null;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

export interface OpenAIErrorDetails {
  status?: number;
  code?: string;
  param?: string | null;
  /** The API's error `type`, e.g. `server_error` or `invalid_request_error`. */
  type?: string;
  requestId?: string | null;
  body?: string;
  /** True when the failure arrived after the stream opened (HTTP 200). */
  midStream?: boolean;
}

export class OpenAIError extends Error {
  constructor(
    message: string,
    readonly opts: OpenAIErrorDetails = {},
  ) {
    super(message);
    this.name = "OpenAIError";
  }
  get status() {
    return this.opts.status;
  }
  get code() {
    return this.opts.code;
  }
  get param() {
    return this.opts.param;
  }
  get type() {
    return this.opts.type;
  }
  get requestId() {
    return this.opts.requestId ?? undefined;
  }

  /**
   * A request-shape complaint the caller can fix by reshaping the body: an HTTP
   * 400, or the same complaint delivered as a mid-stream error.
   */
  get isInvalidRequest(): boolean {
    if (this.status === 400) return true;
    return (
      !!this.opts.midStream &&
      (this.type === "invalid_request_error" || this.code === "subscription_sharing_unsupported_capability")
    );
  }

  /**
   * Worth sending the same turn again after a pause: server-side and network
   * failures, and the plan-usage checks the docs call temporary. Never a usage
   * limit, an auth failure or a bad request.
   */
  get isTransient(): boolean {
    const code = this.code ?? "";
    if (NON_RETRYABLE_CODES.has(code)) return false;
    if (RETRYABLE_SIWC_CODES.has(code) || TRANSIENT_CODES.has(code)) return true;
    if (this.type === "server_error") return true;
    if (this.status !== undefined) return this.status >= 500 || this.status === 408 || (this.status === 429 && code === "rate_limit_exceeded");
    // A mid-stream error that names neither a code nor a request problem.
    return !!this.opts.midStream && !code && this.type !== "invalid_request_error";
  }
}

/** Codes the SIWC docs define for plan usage, with the user-facing meaning of each. */
export const SIWC_ERROR_MESSAGES: Record<string, string> = {
  subscription_sharing_usage_limit_exceeded:
    "Your ChatGPT plan's usage limit for apps has been reached. Check https://chatgpt.com/settings/usage and try again later.",
  subscription_sharing_usage_unavailable:
    "ChatGPT could not check your plan usage right now. Your sign-in is still valid; try again in a few minutes.",
  subscription_sharing_user_unavailable:
    "ChatGPT account information is temporarily unavailable. Try again in a few minutes.",
  subscription_sharing_user_not_eligible:
    "ChatGPT plan usage is not available for this account or workspace.",
  subscription_sharing_unsupported_capability:
    "The request used a feature this ChatGPT plan route does not support.",
  subscription_sharing_route_not_supported: "This endpoint is not supported with ChatGPT plan usage.",
  subscription_sharing_invalid_user:
    "ChatGPT could not validate your sign-in. Sign out and sign in again.",
  chatpass_v2_scope_not_authorized: "Your ChatGPT sign-in does not authorize this request.",
  chatpass_v2_invalid_authorization_context: "Your ChatGPT sign-in does not authorize this request.",
};

/** The plan's allowance for apps is used up. Not a fault: pause plan requests and point at the usage page. */
export const USAGE_LIMIT_CODE = "subscription_sharing_usage_limit_exceeded";

/** The usage page the SIWC docs say to link to when the limit is reached. */
export const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

export function isUsageLimitError(err: unknown): err is OpenAIError {
  return err instanceof OpenAIError && err.code === USAGE_LIMIT_CODE;
}

/** Transient codes: keep credentials, let the user retry later. */
export const RETRYABLE_SIWC_CODES = new Set([
  "subscription_sharing_usage_unavailable",
  "subscription_sharing_user_unavailable",
]);

/** Failures of the transport or the server rather than of the request. */
const TRANSIENT_CODES = new Set(["server_error", "internal_error", "stream_interrupted", "stream_ended", "network_error"]);

/** Codes that must not be retried as-is, whatever their HTTP status. */
const NON_RETRYABLE_CODES = new Set([
  "subscription_sharing_usage_limit_exceeded",
  "subscription_sharing_user_not_eligible",
  "subscription_sharing_unsupported_capability",
  "subscription_sharing_route_not_supported",
  "subscription_sharing_invalid_user",
  "chatpass_v2_scope_not_authorized",
  "chatpass_v2_invalid_authorization_context",
  "insufficient_quota",
  "incomplete",
]);

/** The user-facing text: the documented meaning when there is one, plus what support needs to trace it. */
export function describeOpenAIError(err: OpenAIError): string {
  const code = err.code ?? "";
  const text = SIWC_ERROR_MESSAGES[code] ?? err.message;
  const trace = [code && !text.includes(code) ? code : "", err.requestId ? `request ${err.requestId}` : ""].filter(Boolean);
  return trace.length ? `${text} (${trace.join(", ")})` : text;
}

/** One line for the activity log with everything known about the failure. */
export function errorDiagnostics(err: OpenAIError): string {
  const parts = [
    err.status !== undefined ? `status=${err.status}` : err.opts.midStream ? "mid-stream" : "",
    err.type ? `type=${err.type}` : "",
    err.code ? `code=${err.code}` : "",
    err.param ? `param=${err.param}` : "",
    err.requestId ? `request=${err.requestId}` : "",
  ].filter(Boolean);
  return `${parts.join(" ")}${err.opts.body ? ` body=${err.opts.body.slice(0, 400)}` : ""}`;
}

function errorFromBody(status: number, text: string, requestId: string | null): OpenAIError {
  let code: string | undefined;
  let param: string | null | undefined;
  let type: string | undefined;
  let message = text.slice(0, 300);
  try {
    const json = JSON.parse(text) as { error?: ResponseError | string; detail?: string };
    if (json.error && typeof json.error === "object") {
      code = json.error.code ?? undefined;
      param = json.error.param;
      type = json.error.type;
      message = json.error.message ?? message;
    } else if (typeof json.error === "string") {
      code = json.error;
    } else if (typeof json.detail === "string") {
      // Direct-route admission failures use `{"detail": "..."}`; diagnostic text, not a stable code.
      message = json.detail;
    }
  } catch {
    // keep the raw text
  }
  const known = code ? SIWC_ERROR_MESSAGES[code] : undefined;
  return new OpenAIError(known ?? `OpenAI API error ${status}${code ? ` (${code})` : ""}: ${message}`, {
    status,
    code,
    param,
    type,
    requestId,
    body: text,
  });
}

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------

/** Parse a `text/event-stream` body into JSON events. Tolerates `event:` lines and comments. */
export async function* parseSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line === "") {
          if (data.length) {
            const payload = data.join("\n");
            data = [];
            if (payload !== "[DONE]") {
              try {
                yield JSON.parse(payload) as StreamEvent;
              } catch {
                // A malformed frame is dropped rather than killing the stream.
              }
            }
          }
          continue;
        }
        if (line.startsWith(":")) continue;
        if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        // `event:` and `id:` lines carry nothing the JSON payload doesn't already say.
      }
    }
    if (data.length) {
      try {
        yield JSON.parse(data.join("\n")) as StreamEvent;
      } catch {
        // ignore trailing garbage
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// requests
// ---------------------------------------------------------------------------

export interface StreamOptions {
  accessToken: string;
  request: ResponsesRequest;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  /** Every parsed event, for live narration. Errors thrown here abort the stream. */
  onEvent?: (event: StreamEvent) => void;
}

/**
 * POST /responses and consume the stream to its terminal event. Resolves with
 * the completed response; rejects with an OpenAIError for HTTP failures,
 * `response.failed`, `response.incomplete` and streams that end early.
 */
export async function streamResponse(opts: StreamOptions): Promise<ResponseObject> {
  const fetchImpl = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(`${OPENAI_API_BASE}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${opts.accessToken}`,
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({ ...opts.request, store: false, stream: true }),
      signal: opts.signal,
    });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    throw new OpenAIError(`Could not reach the OpenAI API: ${err instanceof Error ? err.message : String(err)}`, {
      code: "network_error",
    });
  }
  const requestId = res.headers.get("x-request-id");
  if (!res.ok) throw errorFromBody(res.status, await res.text(), requestId);
  if (!res.body) throw new OpenAIError("Response had no body.", { status: res.status, requestId });

  // Items are rebuilt from the per-item events as they stream. The final
  // `response.completed` normally repeats them in `response.output`, but a
  // proxying route may send a slimmer response object, so the streamed items
  // are the primary source and the completed object the cross-check.
  const items = new Map<number, OutputItem>();
  let completed: ResponseObject | undefined;
  let callbackError: unknown;
  try {
    for await (const event of parseSse(res.body, opts.signal)) {
      try {
        opts.onEvent?.(event);
      } catch (err) {
        callbackError = err;
        throw err;
      }
      switch (event.type) {
        case "response.output_item.added":
          if (event.item && typeof event.output_index === "number") items.set(event.output_index, event.item);
          break;
        case "response.output_item.done":
          if (event.item && typeof event.output_index === "number") items.set(event.output_index, event.item);
          break;
        case "response.function_call_arguments.done": {
          const item = typeof event.output_index === "number" ? items.get(event.output_index) : undefined;
          if (item?.type === "function_call" && typeof event.arguments === "string") {
            (item as OutputFunctionCall).arguments = event.arguments;
          }
          break;
        }
        case "response.output_text.done": {
          const item = typeof event.output_index === "number" ? items.get(event.output_index) : undefined;
          if (item?.type === "message" && typeof event.text === "string") {
            const content = (item as OutputMessage).content ?? [];
            const index = typeof event.content_index === "number" ? event.content_index : content.length;
            content[index] = { type: "output_text", text: event.text, annotations: [] };
            (item as OutputMessage).content = content;
          }
          break;
        }
        case "response.completed":
          completed = event.response;
          break;
        case "response.failed": {
          const error = event.response?.error ?? undefined;
          const code = error?.code ?? undefined;
          const known = code ? SIWC_ERROR_MESSAGES[code] : undefined;
          throw new OpenAIError(known ?? `Response failed: ${error?.message ?? code ?? "unknown_error"}`, {
            code,
            param: error?.param,
            type: error?.type,
            requestId,
            body: JSON.stringify(error ?? null),
            midStream: true,
          });
        }
        case "response.incomplete":
          throw new OpenAIError(
            `Response was cut short (${event.response?.incomplete_details?.reason ?? "unknown reason"}).`,
            { code: "incomplete", requestId, midStream: true },
          );
        case "error": {
          // The API reference puts `code` and `message` at the top level, while the
          // SIWC error docs describe an `error` object (`{type, code, message,
          // param}`). Read both; the raw event goes into the activity log.
          const nested = event.error && typeof event.error === "object" ? event.error : undefined;
          const code = nested?.code ?? event.code ?? undefined;
          const message = nested?.message ?? event.message;
          const known = code ? SIWC_ERROR_MESSAGES[code] : undefined;
          throw new OpenAIError(known ?? `Stream error: ${message ?? code ?? nested?.type ?? "no details from the server"}`, {
            code,
            param: nested?.param ?? event.param,
            type: nested?.type,
            requestId,
            body: JSON.stringify(event),
            midStream: true,
          });
        }
      }
    }
  } catch (err) {
    if (err instanceof OpenAIError || err === callbackError || opts.signal?.aborted) throw err;
    // The connection dropped while reading: the turn can be sent again.
    throw new OpenAIError(`The stream was interrupted: ${err instanceof Error ? err.message : String(err)}`, {
      code: "stream_interrupted",
      requestId,
      midStream: true,
    });
  }
  if (!completed) {
    throw new OpenAIError("Stream ended without response.completed.", { code: "stream_ended", requestId, midStream: true });
  }
  const streamed = [...items.entries()].sort(([a], [b]) => a - b).map(([, item]) => item);
  const reported = Array.isArray(completed.output) ? completed.output : [];
  return { ...completed, output: streamed.length >= reported.length ? streamed : reported };
}

// ---------------------------------------------------------------------------
// models
// ---------------------------------------------------------------------------

export interface ModelInfo {
  /** Passed as `model` in requests. */
  slug: string;
  displayName: string;
}

/**
 * GET /models with the user's token. Under SIWC the response carries a `models`
 * array with `visibility`; only `"list"` entries are meant for a picker, in
 * server order. A classic `data` array (plain API keys) is accepted too.
 */
export async function listModels(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<ModelInfo[]> {
  const res = await fetchImpl(`${OPENAI_API_BASE}/models`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  if (!res.ok) throw errorFromBody(res.status, await res.text(), res.headers.get("x-request-id"));
  const json = (await res.json()) as {
    models?: Array<{ slug?: string; id?: string; display_name?: string; visibility?: string }>;
    data?: Array<{ id: string }>;
  };
  if (Array.isArray(json.models)) {
    const named = json.models.filter((m) => m.slug || m.id);
    // `visibility: "list"` marks the models meant for a picker. If the field is
    // absent altogether, showing everything beats showing nothing.
    const listed = named.some((m) => m.visibility !== undefined) ? named.filter((m) => m.visibility === "list") : named;
    return listed.map((m) => ({ slug: (m.slug ?? m.id)!, displayName: m.display_name ?? m.slug ?? m.id! }));
  }
  if (Array.isArray(json.data)) {
    // A plain API key lists everything the org can call, embeddings and TTS
    // included. Keep what the Responses API can drive as an agent.
    return json.data
      .filter((m) => isAgentModel(m.id))
      .map((m) => ({ slug: m.id, displayName: m.id }));
  }
  throw new OpenAIError("Unexpected /models response shape.", { body: JSON.stringify(json).slice(0, 300) });
}

/** Chat/reasoning model IDs, minus the audio, image, embedding and legacy families. */
export function isAgentModel(id: string): boolean {
  if (!/^(gpt-|o\d)/.test(id)) return false;
  return !/(audio|realtime|tts|transcribe|embedding|image|moderation|instruct|search|whisper|dall-e|davinci|babbage)/.test(id);
}
