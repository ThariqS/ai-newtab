import { buildHistoryDigest, slugifyUrl } from "../history-digest";
import {
  OpenAIError,
  errorDiagnostics,
  streamResponse,
  type InputItem,
  type OutputFunctionCall,
  type OutputItem,
  type ResponseObject,
  type ResponsesRequest,
  type StreamEvent,
} from "./client";
import { HOMEPAGE_SYSTEM_PROMPT, OUTPUT_PATH, buildKickoffMessage } from "../prompt";
import { Sandbox, UPLOAD_ROOT, formatHtmlForSandbox, type SandboxSnapshot } from "./sandbox";
import { DEFAULTS } from "../schemas";
import { DEFAULT_BLOCKED_SITES, isAllowedUrl, isBlocked, isPrivateAddress, normalizeBlockList } from "../site-filter";
import type { TokenProvider } from "./siwc";
import { TOOL_DELIVERY_ORDER, bareToolName, isToolName, toolsForRequest, type ToolDelivery, type ToolName } from "./tools";
import type {
  BrowserBridge,
  CommonRunOptions,
  GetHistoryResult,
  GetPageHtmlResult,
  HomepageBuildResult,
  KVStore,
  PageRef,
  RunPhase,
} from "../types";

export const OPENAI_STORAGE_KEYS = {
  /** The in-progress build checkpoint (see below); present means "resumable". */
  activeBuild: "activeBuild",
  /** Learned API compatibility (which tool delivery works, …), so a fallback is paid once. */
  apiCompat: "apiCompat",
} as const;
const STORAGE_KEYS = OPENAI_STORAGE_KEYS;

/** Reasoning effort sent with every request; `medium` balances latency and editorial quality. */
export const DEFAULT_REASONING_EFFORT = "medium" as const;

/** Callbacks with the optionality resolved, so call sites don't repeat `?.`. */
interface Emit {
  phase(phase: RunPhase, detail?: string): void;
  text(chunk: string): void;
  log(line: string): void;
}

export interface OpenAIRunOptions extends CommonRunOptions {
  engine: "openai";
  /** Supplies the bearer token: a Sign in with ChatGPT access token (refreshed as needed) or a plain API key. */
  auth: TokenProvider;
  /** Model slug from `GET /models`. Ignored when resuming: a build keeps the model it started with. */
  model: string;
  /** Continue the checkpointed build a previous run left behind (e.g. after the host was killed). */
  resume?: boolean;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  /** Safety valve against a model that never writes the file. */
  maxTurns?: number;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  /** Pauses before re-sending a turn that failed transiently; its length bounds the retries. Injectable for tests. */
  retryDelaysMs?: number[];
}

/**
 * A turn that fails on the server's side (a 5xx, a mid-stream `server_error`, a
 * dropped connection, a plan-usage check the docs call temporary) is sent again
 * after these pauses. With `store: false` the turn left no trace server-side,
 * so re-sending the same input is safe.
 */
export const DEFAULT_RETRY_DELAYS_MS = [2_000, 6_000, 15_000];

/**
 * Everything needed to pick a build up where it stopped. With `store: false`
 * nothing lives server-side, so the host's KVStore is the only durable copy of
 * the conversation. Saved after every model turn and every tool result.
 */
export interface BuildCheckpoint {
  version: 1;
  buildId: string;
  model: string;
  startedAt: string;
  turn: number;
  input: InputItem[];
  sandbox: SandboxSnapshot;
  finalMessage: string;
}

/** Request shapes the ChatGPT-plan route has rejected, remembered so the fallback is paid once. */
export interface ApiCompat {
  toolDelivery?: ToolDelivery;
  includeReasoning?: boolean;
  reasoningParam?: boolean;
}

const MAX_TURNS = 40;
/** Bound on request reshapes per turn, so a persistently rejected body can't loop. */
const MAX_REQUEST_ADJUSTMENTS = 6;
/** A turn with neither a tool call nor text is nudged this many times before the build fails. */
const MAX_EMPTY_TURN_NUDGES = 2;

export async function runHomepageBuild(opts: OpenAIRunOptions): Promise<HomepageBuildResult> {
  const { bridge, store, callbacks, signal } = opts;
  const emit: Emit = {
    phase: (p, d) => callbacks?.onPhase?.(p, d),
    text: (t) => callbacks?.onText?.(t),
    log: (l) => callbacks?.onLog?.(l),
  };
  const now = opts.now ?? new Date();

  emit.phase("setup");
  let checkpoint = opts.resume ? await store.get<BuildCheckpoint>(STORAGE_KEYS.activeBuild) : undefined;
  if (checkpoint && checkpoint.version !== 1) checkpoint = undefined;

  const buildId = checkpoint?.buildId ?? `build_${now.toISOString().slice(0, 10)}_${Math.random().toString(36).slice(2, 8)}`;
  const model = checkpoint?.model ?? opts.model;
  const startedAt = checkpoint?.startedAt ?? now.toISOString();
  const sandbox = Sandbox.fromSnapshot(checkpoint?.sandbox);
  const input: InputItem[] = checkpoint?.input ?? [
    { role: "user", content: buildKickoffMessage({ now, userSystemPrompt: opts.userSystemPrompt }) },
  ];
  let turn = checkpoint?.turn ?? 0;
  let finalMessage = checkpoint?.finalMessage ?? "";
  let emptyTurns = 0;
  const compat: ApiCompat = (await store.get<ApiCompat>(STORAGE_KEYS.apiCompat)) ?? {};

  const save = () =>
    store.set(STORAGE_KEYS.activeBuild, {
      version: 1,
      buildId,
      model,
      startedAt,
      turn,
      input,
      sandbox: sandbox.snapshot(),
      finalMessage,
    } satisfies BuildCheckpoint);

  if (checkpoint) emit.log(`resuming ${buildId} at turn ${turn} (${input.length} items, ${sandbox.list().length} files)`);
  else emit.log(`build ${buildId} model=${model}`);
  await save();

  /**
   * Every function call gets exactly one output, whatever happens inside the
   * tool: an error becomes an error string the model can react to. A call left
   * without an output would make the next request invalid.
   */
  const dispatch = async (call: OutputFunctionCall): Promise<InputItem> => {
    const name = bareToolName(call.name);
    let output: string;
    try {
      const blockedSites = normalizeBlockList(
        (typeof opts.blockedSites === "function" ? await opts.blockedSites() : opts.blockedSites) ?? DEFAULT_BLOCKED_SITES,
      );
      let args: Record<string, unknown> = {};
      try {
        args = call.arguments?.trim() ? (JSON.parse(call.arguments) as Record<string, unknown>) : {};
      } catch (err) {
        throw new Error(`Arguments were not valid JSON: ${String(err)}`);
      }
      if (!isToolName(name)) throw new Error(`Unknown tool: ${call.name}`);
      output = await runTool(name, args, { bridge, sandbox, emit, blockedSites });
    } catch (err) {
      emit.log(`tool ${name} failed: ${String(err)}`);
      output = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }
    // Echo the namespace a namespaced call came in with, so the output is attributed to the same tool.
    return {
      type: "function_call_output",
      call_id: call.call_id,
      output,
      ...(call.namespace ? { name, namespace: call.namespace } : {}),
    };
  };

  const onEvent = (event: StreamEvent) => {
    switch (event.type) {
      case "response.output_text.delta":
        if (event.delta) emit.text(event.delta);
        break;
      case "response.reasoning_summary_text.delta":
        if (event.delta) emit.text(event.delta);
        break;
      case "response.reasoning_summary_part.done":
        emit.text("\n\n");
        break;
      case "response.output_item.added": {
        const item = event.item;
        if (item?.type === "function_call") {
          const name = bareToolName((item as OutputFunctionCall).name ?? "");
          emit.phase(phaseForTool(name), name);
          emit.log(`tool:${name}`);
        } else if (item?.type === "reasoning") {
          emit.phase("thinking");
        }
        break;
      }
    }
  };

  try {
    // Answer any call left hanging when the previous run died mid-tool.
    const orphaned = unansweredCalls(input);
    for (const call of orphaned) {
      emit.log(`re-answering orphaned tool call ${call.call_id} (${call.name})`);
      input.push(await dispatch(call));
    }
    if (orphaned.length) await save();

    const maxTurns = opts.maxTurns ?? MAX_TURNS;
    while (true) {
      if (signal?.aborted) throw new Error("aborted");
      if (turn >= maxTurns) {
        throw new Error(`Build stopped after ${maxTurns} model turns without a finished homepage.`);
      }
      turn++;
      emit.phase("thinking");

      const response = await requestTurn({
        auth: opts.auth,
        model,
        input,
        compat,
        store,
        emit,
        signal,
        fetch: opts.fetch,
        onEvent,
        reasoningEffort: opts.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
        retryDelaysMs: opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS,
      });
      const usage = response.usage;
      emit.log(
        `turn ${turn}: ${describeOutput(response.output)}` +
          (usage?.total_tokens ? `, ${usage.total_tokens} tokens (${usage.input_tokens ?? 0} in / ${usage.output_tokens ?? 0} out)` : ""),
      );

      // The model's own output goes back verbatim next turn (store: false means
      // we are the memory). Reasoning items are only useful with their
      // encrypted content; without it they can't be replayed, so they're dropped.
      let turnText = "";
      for (const item of response.output) {
        if (item.type === "reasoning" && !(item as { encrypted_content?: string | null }).encrypted_content) continue;
        input.push(item as InputItem);
        if (item.type === "message") {
          for (const block of (item as { content: Array<{ type: string; text?: string }> }).content ?? []) {
            if (block.type === "output_text" && block.text) turnText += block.text;
          }
        }
      }
      finalMessage += turnText;

      const calls = response.output.filter((item): item is OutputFunctionCall => item.type === "function_call");
      if (calls.length === 0) {
        // A turn with no tool call and no text is not a finished build: it is
        // the model stalling (or a route dropping items). Nudge it back into
        // the workflow a couple of times before giving up.
        if (!turnText.trim() && !sandbox.outputs().length && emptyTurns < MAX_EMPTY_TURN_NUDGES) {
          emptyTurns++;
          emit.log(`empty turn (${JSON.stringify(response).slice(0, 300)}); nudging`);
          input.push({
            role: "user",
            content: `Your last response contained no tool call and no text. Continue the workflow: call the next tool, or write ${OUTPUT_PATH} and then summarize.`,
          });
          await save();
          continue;
        }
        await save();
        break;
      }
      for (const call of calls) {
        if (signal?.aborted) throw new Error("aborted");
        input.push(await dispatch(call));
      }
      await save();
    }

    emit.phase("writing");
    const deliverable = collectDeliverable(sandbox, finalMessage, emit);
    emit.phase("done");
    return { code: deliverable.code, engine: "openai", id: buildId, source: deliverable.source, turns: turn };
  } finally {
    // Nothing persists server-side (store: false). The checkpoint is the only
    // state, and a finished, failed or cancelled build must not be resumed.
    emit.phase("cleanup");
    await store.remove(STORAGE_KEYS.activeBuild);
  }
}

// ---------------------------------------------------------------------------
// one model turn, with token refresh and request-shape fallbacks
// ---------------------------------------------------------------------------

async function requestTurn(ctx: {
  auth: TokenProvider;
  model: string;
  input: InputItem[];
  compat: ApiCompat;
  store: KVStore;
  emit: Emit;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  onEvent: (event: StreamEvent) => void;
  reasoningEffort: NonNullable<OpenAIRunOptions["reasoningEffort"]>;
  retryDelaysMs: number[];
}): Promise<ResponseObject> {
  let accessToken = await ctx.auth.getAccessToken();
  let refreshed = false;
  let adjustments = 0;
  let retries = 0;

  while (true) {
    const delivery = ctx.compat.toolDelivery ?? TOOL_DELIVERY_ORDER[0];
    const { tools, inputPrefix } = toolsForRequest(delivery);
    const request: ResponsesRequest = {
      model: ctx.model,
      instructions: HOMEPAGE_SYSTEM_PROMPT,
      input: [...inputPrefix, ...ctx.input],
      store: false,
      stream: true,
    };
    if (tools) request.tools = tools;
    if (ctx.compat.includeReasoning !== false) request.include = ["reasoning.encrypted_content"];
    if (ctx.compat.reasoningParam !== false) request.reasoning = { effort: ctx.reasoningEffort, summary: "auto" };

    try {
      return await streamResponse({
        accessToken,
        request,
        signal: ctx.signal,
        fetch: ctx.fetch,
        onEvent: ctx.onEvent,
      });
    } catch (err) {
      if (!(err instanceof OpenAIError)) throw err;
      if (err.status === 401 && !refreshed) {
        refreshed = true;
        ctx.emit.log("access token rejected (401); refreshing and retrying");
        accessToken = await ctx.auth.getAccessToken({ forceRefresh: true });
        continue;
      }
      if (err.isInvalidRequest && adjustments < MAX_REQUEST_ADJUSTMENTS) {
        const change = adaptRequest(err, ctx.compat);
        if (change) {
          adjustments++;
          ctx.emit.log(`request rejected (${err.code ?? err.status ?? "invalid_request"}${err.param ? ` param=${err.param}` : ""}); ${change}`);
          await ctx.store.set(STORAGE_KEYS.apiCompat, ctx.compat);
          continue;
        }
      }
      if (err.isTransient && retries < ctx.retryDelaysMs.length) {
        const wait = ctx.retryDelaysMs[retries++]!;
        ctx.emit.log(`turn failed (${errorDiagnostics(err)}); retrying in ${Math.round(wait / 1000)}s (${retries}/${ctx.retryDelaysMs.length})`);
        await sleep(wait, ctx.signal);
        continue;
      }
      ctx.emit.log(`turn failed: ${errorDiagnostics(err)}`);
      throw err;
    }
  }
}

/** setTimeout that gives up when the build is cancelled. */
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

/**
 * The ChatGPT-plan route rejects some request shapes with a 400 that names the
 * offending parameter. Reshape once per complaint, in the order the docs
 * suggest, and remember what worked. Returns a description of the change, or
 * null when nothing sensible is left to try.
 */
function adaptRequest(err: OpenAIError, compat: ApiCompat): string | null {
  const hint = `${err.param ?? ""} ${err.message}`.toLowerCase();
  if (compat.includeReasoning !== false && /\binclude\b|encrypted_content/.test(hint)) {
    compat.includeReasoning = false;
    return "dropping include=reasoning.encrypted_content";
  }
  if (compat.reasoningParam !== false && /\breasoning\b/.test(hint)) {
    compat.reasoningParam = false;
    return "dropping the reasoning parameter";
  }
  const current = compat.toolDelivery ?? TOOL_DELIVERY_ORDER[0];
  const next = TOOL_DELIVERY_ORDER[TOOL_DELIVERY_ORDER.indexOf(current) + 1];
  const aboutTools = /tool|namespace|function|additional_tools|input\[0\]/.test(hint) || err.code === "subscription_sharing_unsupported_capability";
  if (next && aboutTools) {
    compat.toolDelivery = next;
    return `switching tool delivery ${current} → ${next}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------

function phaseForTool(name: string): RunPhase {
  switch (name) {
    case "getHistory":
      return "history";
    case "getPageHtml":
      return "scraping";
    case "write":
      return "writing";
    default:
      return "analyzing";
  }
}

interface ToolContext {
  bridge: BrowserBridge;
  sandbox: Sandbox;
  emit: Emit;
  blockedSites: string[];
}

async function runTool(name: ToolName, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  switch (name) {
    case "getHistory":
      return JSON.stringify(await runGetHistory(args, ctx));
    case "getPageHtml":
      return JSON.stringify(await runGetPageHtml(args, ctx));
    case "grep":
      ctx.emit.phase("analyzing", "grep");
      return ctx.sandbox.grep(String(args.pattern ?? ""), {
        path: typeof args.path === "string" ? args.path : undefined,
        ignoreCase: Boolean(args.ignoreCase),
        context: typeof args.context === "number" ? args.context : undefined,
        maxMatches: typeof args.maxMatches === "number" ? args.maxMatches : undefined,
      });
    case "read":
      ctx.emit.phase("analyzing", "read");
      return ctx.sandbox.read(String(args.path ?? ""), {
        offset: typeof args.offset === "number" ? args.offset : undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
      });
    case "glob": {
      ctx.emit.phase("analyzing", "glob");
      const matches = ctx.sandbox.glob(String(args.pattern ?? "**"));
      return matches.length ? matches.join("\n") : `No files match ${JSON.stringify(args.pattern)}.`;
    }
    case "write": {
      ctx.emit.phase("writing");
      const content = typeof args.content === "string" ? args.content : "";
      if (!content.trim()) throw new Error("Refusing to write an empty file.");
      const path = ctx.sandbox.write(String(args.path ?? OUTPUT_PATH), content);
      ctx.emit.log(`wrote ${path} (${content.length}b)`);
      return JSON.stringify({ ok: true, path, bytes: content.length });
    }
  }
}

async function runGetHistory(args: Record<string, unknown>, ctx: ToolContext): Promise<GetHistoryResult> {
  const daysToAnalyze = typeof args.daysToAnalyze === "number" ? args.daysToAnalyze : DEFAULTS.daysToAnalyze;
  const maxResults = typeof args.maxResults === "number" ? args.maxResults : DEFAULTS.maxResults;

  ctx.emit.phase("history", `${daysToAnalyze}d`);
  const { sites, totalSitesSeen } = await ctx.bridge.getHistory({ daysToAnalyze, maxResults });
  const allowed = sites.filter((site) => !isBlocked(site.domain, ctx.blockedSites));
  // Blocked domains are dropped from the count too: the model is never told they exist.
  const digest = buildHistoryDigest(allowed, {
    daysToAnalyze,
    maxResults,
    totalSitesSeen: totalSitesSeen - (sites.length - allowed.length),
  });
  ctx.emit.log(`history: ${digest.sites.length} of ${digest.totalSitesSeen} domains`);
  return digest;
}

async function runGetPageHtml(args: Record<string, unknown>, ctx: ToolContext): Promise<GetPageHtmlResult> {
  const urls = Array.isArray(args.urls) ? args.urls.map(String) : [];
  if (urls.length === 0) throw new Error("getPageHtml needs at least one URL.");
  ctx.emit.phase("scraping", `${urls.length} pages`);

  const allowed: string[] = [];
  const blocked: GetPageHtmlResult["failed"] = [];
  for (const url of urls) {
    // Match on the URL the browser will load; malformed URLs never reach the signed-in browser.
    if (isAllowedUrl(url, ctx.blockedSites)) allowed.push(url);
    else blocked.push({ url, reason: "blocked by the user's settings" });
  }

  // Skip the bridge entirely when nothing is left, so no scraper window opens.
  const { pages: loaded, failed } = allowed.length
    ? await ctx.bridge.getPageHtml({
        urls: allowed,
        loadDelayMs: typeof args.loadDelayMs === "number" ? args.loadDelayMs : DEFAULTS.loadDelayMs,
      })
    : { pages: [], failed: [] };

  // A redirect can land on a blocked host, and a public-looking name can resolve
  // to a private address; drop what such a page read before anything is mounted.
  const pages = loaded.filter((page) => {
    const urlAllowed = !page.finalUrl || isAllowedUrl(page.finalUrl, ctx.blockedSites);
    if (urlAllowed && !(page.ip && isPrivateAddress(page.ip))) return true;
    blocked.push({ url: page.url, reason: "blocked by the user's settings" });
    return false;
  });
  if (blocked.length) ctx.emit.log(`blocked: ${blocked.length} url(s)`);

  const refs: PageRef[] = [];
  const existing = ctx.sandbox.list().length;
  for (const page of pages) {
    const filename = `${slugifyUrl(page.url)}_${existing + refs.length}.html`;
    const html = formatHtmlForSandbox(page.html);
    const mountPath = ctx.sandbox.mount(`${UPLOAD_ROOT}/pages/${filename}`, html);
    refs.push({ url: page.url, title: page.title, mountPath, bytes: html.length });
    ctx.emit.log(`mounted ${page.url} -> ${mountPath} (${html.length}b, ${html.split("\n").length} lines)`);
  }

  const allFailures = [...blocked, ...failed];
  if (refs.length === 0 && allFailures.length > 0 && blocked.length === 0) {
    throw new Error(
      `No pages could be loaded. Failures: ${allFailures.map((f) => `${f.url} (${f.reason})`).join("; ")}`,
    );
  }
  return { pages: refs, failed: allFailures };
}

// ---------------------------------------------------------------------------
// history helpers
// ---------------------------------------------------------------------------

/** `3 item(s): reasoning, function_call getHistory, message` — for the activity log. */
function describeOutput(output: OutputItem[]): string {
  const kinds = output.map((item) =>
    item.type === "function_call" ? `function_call ${bareToolName((item as OutputFunctionCall).name)}` : item.type,
  );
  return `${output.length} item(s)${kinds.length ? `: ${kinds.join(", ")}` : ""}`;
}

/** Function calls in the transcript that never received an output. */
export function unansweredCalls(input: InputItem[]): OutputFunctionCall[] {
  const answered = new Set<string>();
  for (const item of input) {
    if (item.type === "function_call_output") answered.add((item as { call_id: string }).call_id);
  }
  return input.filter(
    (item): item is OutputFunctionCall => item.type === "function_call" && !answered.has((item as OutputFunctionCall).call_id),
  );
}

// ---------------------------------------------------------------------------
// deliverable retrieval
// ---------------------------------------------------------------------------

const CODE_FENCE = /```(?:tsx|jsx|ts|js|typescript|javascript)?\s*\n([\s\S]*?)```/;

/** Strip a ```tsx fence, if the model wrapped the file contents in one. */
function stripFence(text: string): string {
  const fenced = text.match(CODE_FENCE);
  return (fenced ? fenced[1] : text).trim();
}

function collectDeliverable(
  sandbox: Sandbox,
  finalMessage: string,
  emit: Emit,
): { code: string; source: HomepageBuildResult["source"] } {
  const outputs = sandbox.outputs();
  const preferred = outputs.find((f) => f.path === OUTPUT_PATH);
  const candidate = preferred ?? outputs.find((f) => /\.(tsx|jsx|ts|js)$/.test(f.path));
  if (candidate && candidate.content.trim()) {
    emit.log(`deliverable from ${candidate.path} (${candidate.content.length}b)`);
    return { code: stripFence(candidate.content), source: "output-file" };
  }

  // Fallback: the model sometimes answers with the component inline instead of
  // (or as well as) writing it. Better than failing the run outright.
  const fenced = finalMessage.match(CODE_FENCE);
  if (fenced && fenced[1].includes("PersonalizedHomepage")) {
    emit.log("deliverable recovered from message fence");
    return { code: fenced[1].trim(), source: "message-fence" };
  }

  throw new Error(
    `Agent produced no homepage. Expected a file at ${OUTPUT_PATH}. ` +
      `Final message: ${finalMessage.slice(0, 400)}`,
  );
}

export type { OutputItem };
