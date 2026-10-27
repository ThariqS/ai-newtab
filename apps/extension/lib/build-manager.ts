import Anthropic from "@anthropic-ai/sdk";
import {
  CLAUDE_STORAGE_KEYS,
  DEFAULT_OPENAI_MODEL,
  OPENAI_STORAGE_KEYS,
  OpenAIError,
  SiwcError,
  describeOpenAIError,
  isUsageLimitError,
  listModels,
  runHomepageBuild,
  type EngineId,
  type RunOptions,
  type RunPhase,
} from "@homepage/agent-core";
import { shouldAutoRebuild } from "./auto-rebuild";
import { browserBridge } from "./browser-bridge";
import { openaiAuthState, openaiReady, openaiTokenProvider } from "./openai-auth";
import {
  INITIAL_BUILD_STATE,
  LOG_RETENTION,
  stepForPhase,
  type AuthState,
  type BuildMsg,
  type BuildNotice,
  type BuildState,
  type PageMsg,
} from "./protocol";
import { beginSignIn, cancelSignIn, forgetAccount, signOut } from "./siwc-auth";
import {
  KEYS,
  extensionStore,
  loadHomepage,
  loadModelCatalog,
  loadSettings,
  resolveOpenAIModel,
  saveHomepage,
  saveModelCatalog,
  type Settings,
} from "./storage";

type Port = Parameters<Parameters<typeof browser.runtime.onConnect.addListener>[0]>[0];

/**
 * While a turn is active, ping a cheap chrome API on this interval to reset the
 * ~30s MV3 idle-unload timer. The ~1 min alarm heartbeat is the slower safety
 * net that reattaches after an unexpected kill.
 */
const KEEPALIVE_INTERVAL_MS = 20_000;

/** Storage snapshots are throttled so narration deltas don't flood chrome.storage. */
const SNAPSHOT_THROTTLE_MS = 2_000;
/** A late-joining tab doesn't need the whole narration, just enough to look alive. */
const NARRATION_STORAGE_CAP = 2_000;

/** Re-fetch the OpenAI model list when the cache is older than this. */
const MODEL_CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Owns the single build. Runs `runHomepageBuild` in the worker, holds live state,
 * enforces a single-flight lock, broadcasts progress to every connected tab,
 * mirrors a throttled snapshot to storage, and reattaches to an interrupted run
 * on wake. Also fronts every credential (API keys, the ChatGPT sign-in) so
 * tokens never leave the worker.
 *
 * There is one instance per service worker — i.e. one per browser profile — so
 * single-flight is per-profile, which is the right grain.
 */
export class BuildManager {
  private state: BuildState = { ...INITIAL_BUILD_STATE };
  private readonly ports = new Set<Port>();
  private controller: AbortController | null = null;
  private running = false;
  private keepalive: ReturnType<typeof setInterval> | null = null;
  private lastSnapshotAt = 0;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;

  // ---- port lifecycle ------------------------------------------------------

  attach(port: Port) {
    this.ports.add(port);
    port.onMessage.addListener((raw: unknown) => void this.onPageMessage(port, raw as PageMsg));
    port.onDisconnect.addListener(() => this.ports.delete(port));
  }

  private async onPageMessage(port: Port, msg: PageMsg) {
    switch (msg.kind) {
      case "subscribe":
        await this.restoreNotice();
        this.send(port, { kind: "snapshot", state: this.state });
        this.send(port, { kind: "auth", state: await this.authState() });
        break;
      case "refreshAuth":
        this.send(port, { kind: "auth", state: await this.authState() });
        break;
      case "startBuild":
        void this.startBuild({ resume: msg.resume });
        break;
      case "cancel":
        this.cancel();
        break;
      case "dismissNotice":
        this.state = { ...this.state, notice: null };
        this.broadcast({ kind: "snapshot", state: this.state });
        await this.mirror(true);
        break;
      case "signIn":
        try {
          await beginSignIn({
            newAccount: msg.newAccount,
            promptConsent: msg.promptConsent,
            originTabId: port.sender?.tab?.id ?? null,
          });
        } catch (err) {
          console.error("[BuildManager] signIn failed", err);
        }
        await this.broadcastAuth();
        break;
      case "cancelSignIn":
        await cancelSignIn();
        await this.broadcastAuth();
        break;
      case "signOut":
        if (msg.forget) await forgetAccount();
        else await signOut();
        await extensionStore.remove(KEYS.modelCatalog);
        await this.broadcastAuth();
        break;
      case "listModels":
        this.send(port, await this.modelsMessage(Boolean(msg.refresh)));
        break;
    }
  }

  private send(port: Port, msg: BuildMsg) {
    try {
      port.postMessage(msg);
    } catch {
      // Port went away between the has-check and the post; drop it.
      this.ports.delete(port);
    }
  }

  private broadcast(msg: BuildMsg) {
    for (const port of [...this.ports]) this.send(port, msg);
  }

  // ---- credentials ---------------------------------------------------------

  private async authState(): Promise<AuthState> {
    const settings = await loadSettings();
    const openai = await openaiAuthState(settings);
    const claudeReady = Boolean(settings.apiKey);
    const ready = settings.engine === "claude" ? claudeReady : await openaiReady(settings);
    return { engine: settings.engine, ready, claudeReady, openai };
  }

  /** Push the current credential state to every tab (after a callback completes, a sign-out, …). */
  async broadcastAuth() {
    this.broadcast({ kind: "auth", state: await this.authState() });
  }

  // ---- models (OpenAI engine) ---------------------------------------------

  private async modelsMessage(refresh: boolean): Promise<BuildMsg> {
    const cached = await loadModelCatalog();
    const fresh = cached && Date.now() - new Date(cached.fetchedAt).getTime() < MODEL_CATALOG_TTL_MS;
    if (cached && fresh && !refresh) return { kind: "models", models: cached.models, error: null };
    try {
      const settings = await loadSettings();
      const models = await listModels(await openaiTokenProvider(settings).getAccessToken());
      await saveModelCatalog(models);
      return { kind: "models", models, error: null };
    } catch (err) {
      return {
        kind: "models",
        models: cached?.models ?? [],
        error: err instanceof OpenAIError ? describeOpenAIError(err) : err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ---- heartbeat -----------------------------------------------------------

  /**
   * Called on worker wake and on every alarm tick. If a build was left
   * mid-flight (a Claude session, or an OpenAI checkpoint), reattach and
   * continue. Otherwise, consider the daily rebuild. The single-flight lock is
   * the arbiter that keeps these from racing.
   */
  async tick() {
    if (this.running) {
      // A run is live but the worker may have just woken; make sure the
      // self-keepalive is ticking so the active turn stays warm.
      this.startKeepalive();
      return;
    }

    if (await this.resumableEngine()) {
      void this.startBuild({ resume: true });
      return;
    }

    await this.maybeAutoRebuild();
  }

  /** Which engine left a build mid-flight, if any. */
  private async resumableEngine(): Promise<EngineId | null> {
    if (await extensionStore.get<string>(CLAUDE_STORAGE_KEYS.activeSessionId)) return "claude";
    if (await extensionStore.get<unknown>(OPENAI_STORAGE_KEYS.activeBuild)) return "openai";
    return null;
  }

  /** Whether opening the day's first tab should already show a fresh homepage. */
  private async maybeAutoRebuild() {
    const [settings, homepage, lastAttempt] = await Promise.all([
      loadSettings(),
      loadHomepage(),
      extensionStore.get<string>(KEYS.lastAutoBuildAttempt),
    ]);
    const now = new Date();
    const hasCredentials = settings.engine === "claude" ? Boolean(settings.apiKey) : await openaiReady(settings);

    if (
      !shouldAutoRebuild({
        enabled: settings.autoRebuild,
        // Named for the Claude key upstream; true when the selected engine can build.
        hasApiKey: hasCredentials,
        isRunning: this.running,
        lastBuildTimestamp: homepage?.timestamp,
        lastAutoAttemptTimestamp: lastAttempt,
        now,
      })
    ) {
      return;
    }

    // Stamp the attempt before starting so a second wake (or a cancel/failure)
    // doesn't re-trigger it this morning.
    await extensionStore.set(KEYS.lastAutoBuildAttempt, now.toISOString());
    void this.startBuild({ resume: false });
  }

  // ---- the build -----------------------------------------------------------

  async startBuild(opts: { resume?: boolean } = {}) {
    if (this.running) {
      console.log("[BuildManager] startBuild ignored — a build is already running");
      return; // single-flight: a second start just attaches.
    }

    // Claim the lock before the first await. On wake, tick() fires from several
    // listeners at once (top level, onStartup, onInstalled, the alarm); if the
    // lock waited for loadSettings, each of them would start its own session.
    this.running = true;
    this.controller = new AbortController();

    try {
      const settings = await loadSettings();
      // A resume belongs to whichever engine left state behind, whatever is selected now.
      const engine = (opts.resume && (await this.resumableEngine())) || settings.engine;
      const common = {
        bridge: browserBridge,
        store: extensionStore,
        userSystemPrompt: settings.systemPrompt,
        blockedSites: async () => (await loadSettings()).blockedSites,
      };

      let run: RunOptions;
      if (engine === "claude") {
        if (!settings.apiKey) {
          // Manual builds are gated behind the setup screen and auto-builds
          // require credentials, so this only happens if the key was removed.
          console.warn("[BuildManager] startBuild aborted — no API key in storage");
          await this.fail("No Anthropic API key found. Add your key and try again.", { notify: false });
          return;
        }
        // The key is the user's own, read from local storage — there is no server
        // to hide it behind. See ARCHITECTURE.md → Privacy.
        const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true });
        const resumeSessionId = opts.resume
          ? await extensionStore.get<string>(CLAUDE_STORAGE_KEYS.activeSessionId)
          : undefined;
        run = { engine: "claude", client, model: settings.model, resumeSessionId, ...common };
      } else {
        if (!(await openaiReady(settings))) {
          const message =
            settings.openaiAuthMode === "apiKey"
              ? "No OpenAI API key found. Add your key and try again."
              : "Not signed in with ChatGPT, or ChatGPT plan usage was not granted. Sign in and try again.";
          console.warn("[BuildManager] startBuild aborted — OpenAI engine not ready");
          await this.fail(message, { notify: false });
          return;
        }
        const model = resolveOpenAIModel(settings.openaiModel, await loadModelCatalog(), DEFAULT_OPENAI_MODEL);
        run = { engine: "openai", auth: openaiTokenProvider(settings), model, resume: opts.resume, ...common };
      }

      this.state = { ...INITIAL_BUILD_STATE, running: true, phase: "setup" };
      this.broadcast({ kind: "snapshot", state: this.state });
      this.startKeepalive();
      console.log("[BuildManager] build started", { engine, resume: Boolean(opts.resume) });

      const result = await runHomepageBuild({
        ...run,
        signal: this.controller.signal,
        callbacks: {
          onPhase: (phase, detail) => this.onPhase(phase, detail),
          onText: (chunk) => this.onText(chunk),
          onLog: (line) => this.onLog(line),
        },
      });

      // Persist the raw TSX; the page transpiles it for preview.
      await saveHomepage(result.code);

      this.state = { ...this.state, running: false, phase: "done" };
      this.broadcast({ kind: "done", code: result.code });
      await this.mirror(true);
      console.log("[BuildManager] build done", { engine: result.engine, bytes: result.code.length, source: result.source });
    } catch (error) {
      if (isUsageLimitError(error)) {
        // Not a failure: the plan's allowance for apps is used up until it
        // resets. Per the SIWC docs, stop and point at the usage page; no
        // "build failed" notification, no retry.
        await this.pause({ kind: "usage-limit", at: new Date().toISOString() });
        console.warn("[BuildManager] ChatGPT plan usage limit reached; build paused", error.opts.requestId ?? "");
        return;
      }
      await this.fail(describeError(error), { notify: true });
      console.error("[BuildManager] build failed", error);
      // A sign-in that is gone for good is reflected on every tab right away.
      if (error instanceof SiwcError) await this.broadcastAuth();
    } finally {
      this.running = false;
      this.controller = null;
      this.stopKeepalive();
    }
  }

  private async pause(notice: BuildNotice) {
    this.state = { ...this.state, running: false, phase: null, error: null, notice };
    this.broadcast({ kind: "notice", notice });
    await this.mirror(true);
  }

  /**
   * A notice must outlive the worker: the morning build can hit the limit with
   * no tab open, and the worker is unloaded long before the user looks. A fresh
   * worker with nothing of its own to show picks it up from the stored snapshot.
   */
  private async restoreNotice() {
    if (this.state.running || this.state.phase !== null || this.state.notice) return;
    const stored = await extensionStore.get<BuildState>(KEYS.buildSnapshot);
    if (stored?.notice && !stored.running) this.state = { ...this.state, notice: stored.notice };
  }

  private async fail(message: string, opts: { notify: boolean }) {
    this.state = { ...this.state, running: false, phase: "error", error: message, notice: null };
    this.broadcast({ kind: "error", message });
    await this.mirror(true);
    if (opts.notify) this.notifyFailure(message);
  }

  cancel() {
    this.controller?.abort();
  }

  // ---- callback fan-out ----------------------------------------------------

  private onPhase(phase: RunPhase, detail?: string) {
    const mapped = stepForPhase(phase);
    const stepIndex =
      mapped === undefined ? this.state.stepIndex : Math.max(this.state.stepIndex, mapped);
    this.state = { ...this.state, phase, stepIndex, detail: detail ?? "" };
    this.broadcast({ kind: "phase", phase, stepIndex, detail: detail ?? "" });
    void this.mirror(false);
  }

  private onText(chunk: string) {
    this.state = { ...this.state, narration: this.state.narration + chunk };
    this.broadcast({ kind: "text", chunk });
    void this.mirror(false);
  }

  private onLog(line: string) {
    this.state = { ...this.state, logs: [...this.state.logs.slice(-LOG_RETENTION), line] };
    this.broadcast({ kind: "log", line });
    void this.mirror(false);
  }

  // ---- storage mirror ------------------------------------------------------

  /**
   * Mirror a lightweight snapshot to storage so a tab that opens while the worker
   * is asleep paints last-known state instantly; the heartbeat then revives the
   * live run. Deltas go over the port; storage only gets a throttled snapshot.
   */
  private async mirror(force: boolean) {
    const now = Date.now();
    if (!force && now - this.lastSnapshotAt < SNAPSHOT_THROTTLE_MS) {
      this.snapshotTimer ??= setTimeout(() => {
        this.snapshotTimer = null;
        void this.mirror(true);
      }, SNAPSHOT_THROTTLE_MS);
      return;
    }

    this.lastSnapshotAt = now;
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }

    const trimmed: BuildState = {
      ...this.state,
      narration: this.state.narration.slice(-NARRATION_STORAGE_CAP),
      logs: this.state.logs.slice(-LOG_RETENTION),
    };
    await extensionStore.set(KEYS.buildSnapshot, trimmed);
  }

  // ---- worker keepalive ----------------------------------------------------

  private startKeepalive() {
    this.keepalive ??= setInterval(() => {
      // A cheap chrome API call resets the ~30s idle-unload timer while a turn is
      // in flight (the in-flight fetch does most of the work; this covers the
      // gaps between requests).
      void browser.runtime.getPlatformInfo();
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive() {
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
  }

  // ---- failure surfacing ---------------------------------------------------

  private notifyFailure(message: string) {
    // Only ping when nobody is watching — an open tab already shows the error
    // inline. A headless daily build that fails otherwise vanishes silently.
    if (this.ports.size > 0) return;
    try {
      browser.notifications.create({
        type: "basic",
        iconUrl: browser.runtime.getURL("/icon/128.png"),
        title: "Homepage build failed",
        message: message.slice(0, 200),
      });
    } catch {
      // notifications permission missing or API unavailable — nothing else to do.
    }
  }
}

/** A user-facing line for whatever the build threw. */
function describeError(error: unknown): string {
  if (error instanceof OpenAIError) return describeOpenAIError(error);
  if (error instanceof Error) return error.message === "aborted" ? "Build cancelled." : error.message;
  return String(error);
}

export type { Settings };
