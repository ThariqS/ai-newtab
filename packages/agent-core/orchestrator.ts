import type Anthropic from "@anthropic-ai/sdk";
import { buildHistoryDigest, slugifyUrl } from "./history-digest";
import { OUTPUT_PATH, buildKickoffMessage } from "./prompt";
import { DEFAULTS } from "./schemas";
import { STORAGE_KEYS, ensureAgent, ensureEnvironment, type HomepageModel } from "./setup";
import type {
  BrowserBridge,
  GetHistoryResult,
  GetPageHtmlResult,
  HomepageBuildResult,
  KVStore,
  PageRef,
  RunCallbacks,
  RunPhase,
} from "./types";

type SessionEvent = Anthropic.Beta.Sessions.BetaManagedAgentsSessionEvent;
type CustomToolUse = Anthropic.Beta.Sessions.BetaManagedAgentsAgentCustomToolUseEvent;

/** Callbacks with the optionality resolved, so call sites don't repeat `?.`. */
interface Emit {
  phase(phase: RunPhase, detail?: string): void;
  text(chunk: string): void;
  log(line: string): void;
}

const MANAGED_AGENTS_BETA = "managed-agents-2026-04-01";

/** Files mount under this root no matter what path you ask for. Ask for it directly. */
const UPLOAD_ROOT = "/mnt/session/uploads";

/** Consecutive failed reconnects before the build gives up. Reset by any received event. */
const MAX_STREAM_RECONNECTS = 5;

/** The agent's turn is over: it finished, gave up, or the session is gone. */
function isTurnEnd(event: SessionEvent): boolean {
  return (
    event.type === "session.status_terminated" ||
    (event.type === "session.status_idle" && event.stop_reason.type !== "requires_action")
  );
}

export interface RunOptions {
  client: Anthropic;
  bridge: BrowserBridge;
  store: KVStore;
  userSystemPrompt?: string;
  /** Ignored when resuming: the session keeps the agent (and model) it started with. */
  model?: HomepageModel;
  callbacks?: RunCallbacks;
  signal?: AbortSignal;
  /** Reattach to an existing session instead of creating one (e.g. after the host was killed mid-run). */
  resumeSessionId?: string;
  now?: Date;
}

export async function runHomepageBuild(opts: RunOptions): Promise<HomepageBuildResult> {
  const { client, bridge, store, callbacks, signal } = opts;
  const emit: Emit = {
    phase: (p, d) => callbacks?.onPhase?.(p, d),
    text: (t) => callbacks?.onText?.(t),
    log: (l) => callbacks?.onLog?.(l),
  };

  emit.phase("setup");
  const [agentId, environmentId] = await Promise.all([
    ensureAgent(client, store, opts.model),
    ensureEnvironment(client, store),
  ]);
  emit.log(`agent=${agentId} environment=${environmentId}`);

  let sessionId = opts.resumeSessionId;
  if (!sessionId) {
    emit.phase("session-create");
    const session = await client.beta.sessions.create({
      agent: agentId,
      environment_id: environmentId,
      title: `Homepage ${(opts.now ?? new Date()).toISOString().slice(0, 10)}`,
    });
    sessionId = session.id;
    await store.set(STORAGE_KEYS.activeSessionId, sessionId);
  }
  emit.log(`session=${sessionId}`);

  // Persist upload IDs so cleanup can still find them after a reattach.
  const uploadedFileIds: string[] =
    (await store.get<string[]>(STORAGE_KEYS.uploadedFileIds)) ?? [];
  const rememberUpload = async (id: string) => {
    uploadedFileIds.push(id);
    await store.set(STORAGE_KEYS.uploadedFileIds, uploadedFileIds);
  };

  let finalMessage = "";

  /**
   * Every tool call must get a result. An `agent.custom_tool_use` that never
   * receives one leaves the session idle forever — the single unrecoverable bug
   * in this design. If sending fails (the network dropped), this throws and the
   * stream loop below reconnects and re-answers from history; the computed result
   * is kept so a resend doesn't redo the scrape.
   */
  const unsentResults = new Map<string, { text: string; isError: boolean }>();
  const answered = new Set<string>();
  const dispatch = async (event: CustomToolUse): Promise<void> => {
    let payload = unsentResults.get(event.id);
    if (!payload) {
      try {
        let result: GetHistoryResult | GetPageHtmlResult;
        switch (event.name) {
          case "getHistory":
            result = await runGetHistory(event, bridge, emit);
            break;
          case "getPageHtml":
            result = await runGetPageHtml(event, { client, bridge, sessionId: sessionId!, rememberUpload, emit });
            break;
          default:
            throw new Error(`Unknown custom tool: ${event.name}`);
        }
        payload = { text: JSON.stringify(result), isError: false };
      } catch (err) {
        emit.log(`tool ${event.name} failed: ${String(err)}`);
        payload = { text: String(err), isError: true };
      }
      unsentResults.set(event.id, payload);
    }

    await client.beta.sessions.events.send(sessionId!, {
      events: [
        {
          type: "user.custom_tool_result",
          custom_tool_use_id: event.id,
          ...(payload.isError && { is_error: true }),
          content: [{ type: "text", text: payload.text }],
        },
      ],
    });
    unsentResults.delete(event.id);
    answered.add(event.id);
  };

  const observe = (event: SessionEvent) => {
    switch (event.type) {
      case "agent.message":
        for (const block of event.content) {
          if (block.type === "text") {
            finalMessage += block.text;
            emit.text(block.text);
          }
        }
        break;
      case "agent.thinking":
        emit.phase("thinking");
        break;
      case "agent.tool_use":
        emit.phase("analyzing", event.name);
        emit.log(`sandbox:${event.name}`);
        break;
      case "session.error":
        emit.log(`session.error: ${JSON.stringify(event)}`);
        break;
    }
  };

  try {
    const seen = new Set<string>();
    let kickedOff = false;
    let reconnects = 0;

    // Each pass opens the stream, replays history, then follows the stream until
    // the turn ends. A dropped connection (long tool calls leave the stream unread
    // for minutes) starts another pass instead of failing the build: the replay
    // picks up whatever happened in the gap, so nothing is lost.
    for (;;) {
      let stream: Awaited<ReturnType<typeof client.beta.sessions.events.stream>> | undefined;
      try {
        // ---- Open the stream BEFORE anything else. It only delivers events emitted
        // ---- after it opens; send first and the early transitions are gone.
        stream = await client.beta.sessions.events.stream(sessionId, undefined, { signal });

        // ---- Then replay history. Covers the gap before the stream attached, and
        // ---- is what makes a reattach (or reconnect) lossless.
        const history: SessionEvent[] = [];
        for await (const event of client.beta.sessions.events.list(sessionId)) {
          history.push(event);
        }

        for (const event of history) {
          if (event.type === "user.custom_tool_result") answered.add(event.custom_tool_use_id);
          if (event.type === "user.message") kickedOff = true;
        }
        for (const event of history) {
          if (!seen.has(event.id)) {
            seen.add(event.id);
            observe(event);
          }
        }

        // Only a turn we started can have ended.
        if (kickedOff && history.some(isTurnEnd)) break;

        // Re-answer any tool call that was left hanging when the stream dropped.
        for (const event of history) {
          if (event.type === "agent.custom_tool_use" && !answered.has(event.id)) {
            emit.log(`re-answering orphaned tool call ${event.id}`);
            await dispatch(event);
          }
        }

        if (!kickedOff) {
          await client.beta.sessions.events.send(sessionId, {
            events: [
              {
                type: "user.message",
                content: [
                  {
                    type: "text",
                    text: buildKickoffMessage({
                      now: opts.now ?? new Date(),
                      userSystemPrompt: opts.userSystemPrompt,
                    }),
                  },
                ],
              },
            ],
          });
          kickedOff = true;
        }

        let ended = false;
        for await (const event of stream) {
          if (signal?.aborted) throw new Error("aborted");

          // Live-preview events carry no `id` and are never terminal. They only
          // arrive if `event_deltas` was requested, but the stream union includes
          // them either way — reading `.id` off one would throw.
          if (event.type === "event_start" || event.type === "event_delta") continue;

          reconnects = 0; // the connection is healthy again

          if (!seen.has(event.id)) {
            seen.add(event.id);
            observe(event);
            if (event.type === "agent.custom_tool_use") {
              await dispatch(event);
            }
          }

          // Terminal checks run for *every* event, including ones we've already
          // seen. `continue`-ing on a duplicate above would skip the terminal
          // event that arrived in the history fetch, and the loop would never end.
          if (isTurnEnd(event)) {
            if (event.type === "session.status_idle") emit.log(`idle: ${event.stop_reason.type}`);
            ended = true;
            break;
          }
        }
        if (ended) break;
        throw new Error("event stream closed before the turn ended");
      } catch (err) {
        if (signal?.aborted) throw err;
        if (++reconnects > MAX_STREAM_RECONNECTS) throw err;
        emit.log(`stream lost (${String(err)}); reconnecting ${reconnects}/${MAX_STREAM_RECONNECTS}`);
        await new Promise((r) => setTimeout(r, 1000 * reconnects));
      } finally {
        stream?.controller.abort();
      }
    }

    emit.phase("writing");
    const code = await collectDeliverable(client, sessionId, finalMessage, emit);
    emit.phase("done");
    return { code: code.code, sessionId, source: code.source };
  } finally {
    // Privacy: the event log holds every domain, title and page body we sent,
    // and uploads persist independently of the session. Delete both, always.
    emit.phase("cleanup");
    await Promise.allSettled(uploadedFileIds.map((id) => client.beta.files.delete(id)));
    await store.remove(STORAGE_KEYS.uploadedFileIds);
    await deleteSessionWhenSettled(client, sessionId!).catch(() => {});
    await store.remove(STORAGE_KEYS.activeSessionId);
  }
}

// ---------------------------------------------------------------------------
// tool implementations
// ---------------------------------------------------------------------------

async function runGetHistory(
  event: CustomToolUse,
  bridge: BrowserBridge,
  emit: Emit,
): Promise<GetHistoryResult> {
  const input = event.input as { daysToAnalyze?: number; maxResults?: number };
  const daysToAnalyze = input.daysToAnalyze ?? DEFAULTS.daysToAnalyze;
  const maxResults = input.maxResults ?? DEFAULTS.maxResults;

  emit.phase("history", `${daysToAnalyze}d`);
  const { sites, totalSitesSeen } = await bridge.getHistory({ daysToAnalyze, maxResults });
  const digest = buildHistoryDigest(sites, { daysToAnalyze, maxResults, totalSitesSeen });
  emit.log(`history: ${digest.sites.length} of ${digest.totalSitesSeen} domains`);
  return digest;
}

async function runGetPageHtml(
  event: CustomToolUse,
  ctx: {
    client: Anthropic;
    bridge: BrowserBridge;
    sessionId: string;
    rememberUpload: (id: string) => Promise<void>;
    emit: Emit;
  },
): Promise<GetPageHtmlResult> {
  const input = event.input as { urls: string[]; loadDelayMs?: number };
  ctx.emit.phase("scraping", `${input.urls.length} pages`);

  const { pages, failed } = await ctx.bridge.getPageHtml({
    urls: input.urls,
    loadDelayMs: input.loadDelayMs ?? DEFAULTS.loadDelayMs,
  });

  const refs: PageRef[] = [];
  const mountFailures = [...failed];

  for (const page of pages) {
    try {
      const filename = `${slugifyUrl(page.url)}_${refs.length}.html`;
      const upload = await ctx.client.beta.files.upload({
        file: new File([page.html], filename, { type: "text/html" }),
      });
      await ctx.rememberUpload(upload.id);

      // Mount mid-session, while the session idles awaiting this very result.
      // The API re-roots every mount under /mnt/session/uploads (see below).
      const resource = await ctx.client.beta.sessions.resources.add(ctx.sessionId, {
        type: "file",
        file_id: upload.id,
        mount_path: `${UPLOAD_ROOT}/pages/${filename}`,
      });

      refs.push({
        url: page.url,
        title: page.title,
        // The API re-roots every mount under /mnt/session/uploads. Report what it
        // resolved, not what we asked for, or the model greps a path that isn't there.
        mountPath: resource.mount_path,
        bytes: page.html.length,
      });
      ctx.emit.log(`mounted ${page.url} -> ${resource.mount_path} (${page.html.length}b)`);
    } catch (err) {
      mountFailures.push({ url: page.url, reason: `mount failed: ${String(err)}` });
    }
  }

  if (refs.length === 0 && mountFailures.length > 0) {
    throw new Error(
      `No pages could be mounted. Failures: ${mountFailures
        .map((f) => `${f.url} (${f.reason})`)
        .join("; ")}`,
    );
  }

  return { pages: refs, failed: mountFailures };
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

async function collectDeliverable(
  client: Anthropic,
  sessionId: string,
  finalMessage: string,
  emit: Emit,
): Promise<{ code: string; source: HomepageBuildResult["source"] }> {
  // There is a short indexing lag between status_idle and outputs appearing.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      for await (const file of client.beta.files.list({
        scope_id: sessionId,
        betas: [MANAGED_AGENTS_BETA],
      })) {
        if (!/\.(tsx|jsx|ts|js)$/.test(file.filename)) continue;
        const response = await client.beta.files.download(file.id);
        const text = await response.text();
        if (text.trim()) {
          emit.log(`deliverable from session output: ${file.filename} (${text.length}b)`);
          return { code: stripFence(text), source: "session-output" };
        }
      }
    } catch (err) {
      emit.log(`files.list attempt ${attempt + 1} failed: ${String(err)}`);
    }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
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

/**
 * The stream reports idle slightly before the session's queryable status catches
 * up; deleting immediately intermittently 400s with "cannot delete while running".
 */
async function deleteSessionWhenSettled(client: Anthropic, sessionId: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const session = await client.beta.sessions.retrieve(sessionId);
    if (session.status !== "running") break;
    await new Promise((r) => setTimeout(r, 200));
  }
  await client.beta.sessions.delete(sessionId);
}
