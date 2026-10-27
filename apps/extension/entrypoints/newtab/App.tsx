import { useCallback, useEffect, useState } from "react";
import {
  CLAUDE_STORAGE_KEYS,
  DEFAULT_MODEL,
  DEFAULT_BLOCKED_SITES,
  OPENAI_STORAGE_KEYS,
  type EngineId,
  type HomepageModel,
} from "@homepage/agent-core";
import { BUILD_STEPS, type AuthState } from "@/lib/protocol";
import { extensionStore, loadHomepage, loadSettings, saveSetting } from "@/lib/storage";
import { toRenderable } from "@/lib/transpile";
import { BuildProgress } from "./components/BuildProgress";
import { HomepagePreview } from "./components/HomepagePreview";
import { SettingsModal } from "./components/SettingsModal";
import { Setup } from "./components/Setup";
import { UsageLimitNotice } from "./components/UsageLimitNotice";
import { btn, errorBox } from "./components/ui";
import { useHomepageBuild } from "./useHomepageBuild";

export default function App() {
  const [loading, setLoading] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [blockedSites, setBlockedSites] = useState<string[]>(DEFAULT_BLOCKED_SITES);
  const [model, setModel] = useState<HomepageModel>(DEFAULT_MODEL);
  const [openaiModel, setOpenaiModel] = useState<string | null>(null);
  const [autoRebuild, setAutoRebuild] = useState(true);
  /** Transpiled homepage, ready for Sandpack. */
  const [renderedCode, setRenderedCode] = useState<string | null>(null);
  /** A build left mid-flight (Claude session or OpenAI checkpoint), offered as "Resume interrupted build". */
  const [resumable, setResumable] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  /** Expand the full progress view over an existing homepage. */
  const [viewProgress, setViewProgress] = useState(false);
  /** The error the user dismissed, so a stale banner doesn't linger. */
  const [dismissedError, setDismissedError] = useState<string | null>(null);

  const { state, auth, models, build, cancel, dismissNotice, refreshAuth, signIn, cancelSignIn, signOut, loadModels } =
    useHomepageBuild((code) => setRenderedCode(toRenderable(code)));

  // Once a build finishes, drop back to the homepage view.
  useEffect(() => {
    if (!state.running) setViewProgress(false);
  }, [state.running]);

  // Scheduled rebuilds are driven by the worker's alarm, not by opening a tab;
  // useHomepageBuild surfaces any build already in flight.
  useEffect(() => {
    (async () => {
      try {
        const [settings, homepage, activeSession, checkpoint] = await Promise.all([
          loadSettings(),
          loadHomepage(),
          extensionStore.get<string>(CLAUDE_STORAGE_KEYS.activeSessionId),
          extensionStore.get<unknown>(OPENAI_STORAGE_KEYS.activeBuild),
        ]);
        setSystemPrompt(settings.systemPrompt);
        setBlockedSites(settings.blockedSites);
        setModel(settings.model);
        setOpenaiModel(settings.openaiModel);
        setAutoRebuild(settings.autoRebuild);
        setResumable(Boolean(activeSession || checkpoint));
        if (homepage?.code) setRenderedCode(toRenderable(homepage.code));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ---- credentials and engine: saved here, judged by the worker ------------
  const chooseEngine = useCallback(
    async (engine: EngineId) => {
      await saveSetting("engine", engine);
      refreshAuth();
    },
    [refreshAuth],
  );
  const chooseOpenAIMode = useCallback(
    async (mode: AuthState["openai"]["mode"]) => {
      await saveSetting("openaiAuthMode", mode);
      refreshAuth();
    },
    [refreshAuth],
  );
  /**
   * From the usage-limit notice: switch the OpenAI engine to API-key billing.
   * With a key already saved the build starts at once; without one, the setup
   * screen opens on the OpenAI key field.
   */
  const switchToApiKey = useCallback(async () => {
    const hasKey = Boolean(auth?.openai.apiKeySaved);
    await chooseOpenAIMode("apiKey");
    if (hasKey) build();
  }, [auth, chooseOpenAIMode, build]);
  const saveAnthropicKey = useCallback(
    async (key: string) => {
      await saveSetting("apiKey", key);
      refreshAuth();
    },
    [refreshAuth],
  );
  const saveOpenAIKey = useCallback(
    async (key: string) => {
      await saveSetting("openaiApiKey", key);
      refreshAuth();
    },
    [refreshAuth],
  );
  const forgetKey = useCallback(async () => {
    if (!auth) return;
    if (auth.engine === "claude") await saveSetting("apiKey", null);
    else await saveSetting("openaiApiKey", null);
    setShowSettings(false);
    refreshAuth();
  }, [auth, refreshAuth]);

  const savePrompt = useCallback(
    async (prompt: string, sites: string[]) => {
      await Promise.all([saveSetting("systemPrompt", prompt), saveSetting("blockedSites", sites)]);
      setBlockedSites(sites);
      setSystemPrompt(prompt);
      setShowSettings(false);
      setRenderedCode(null);
      build();
    },
    [build],
  );

  // These persist immediately; the worker reads them on its next heartbeat or build.
  const changeModel = useCallback(async (next: HomepageModel) => {
    setModel(next);
    await saveSetting("model", next);
  }, []);
  const changeOpenAIModel = useCallback(async (next: string) => {
    setOpenaiModel(next);
    await saveSetting("openaiModel", next);
  }, []);
  const toggleAutoRebuild = useCallback(async (next: boolean) => {
    setAutoRebuild(next);
    await saveSetting("autoRebuild", next);
  }, []);

  if (loading || auth === null) return <div style={{ padding: 20, textAlign: "center" }}>Loading…</div>;

  if (!auth.ready) {
    return (
      <Setup
        auth={auth}
        onChooseEngine={chooseEngine}
        onChooseOpenAIMode={chooseOpenAIMode}
        onSaveAnthropicKey={saveAnthropicKey}
        onSaveOpenAIKey={saveOpenAIKey}
        onSignIn={signIn}
        onCancelSignIn={cancelSignIn}
        onSignOut={() => signOut()}
      />
    );
  }

  const settingsModal = showSettings && (
    <SettingsModal
      initialPrompt={systemPrompt}
      blockedSites={blockedSites}
      auth={auth}
      onChangeEngine={chooseEngine}
      model={model}
      onChangeModel={changeModel}
      onChangeOpenAIMode={chooseOpenAIMode}
      openaiModel={openaiModel}
      models={models}
      onLoadModels={loadModels}
      onChangeOpenAIModel={changeOpenAIModel}
      onForgetKey={forgetKey}
      onSignOut={signOut}
      autoRebuild={autoRebuild}
      onToggleAutoRebuild={toggleAutoRebuild}
      onClose={() => setShowSettings(false)}
      onSave={savePrompt}
    />
  );

  // The usage-limit notice only concerns builds billed to the ChatGPT plan.
  const usageNotice =
    state.notice?.kind === "usage-limit" && auth.engine === "openai" && auth.openai.mode === "siwc" ? state.notice : null;
  const noticeProps = usageNotice && {
    notice: usageNotice,
    apiKeySaved: auth.openai.apiKeySaved,
    onUseApiKey: () => void switchToApiKey(),
    onRetry: () => build(),
  };

  // With no homepage to fall back to, a running build takes over the tab.
  if (state.running && (!renderedCode || viewProgress)) {
    return (
      <BuildProgress
        state={state}
        onCancel={cancel}
        onBack={renderedCode ? () => setViewProgress(false) : undefined}
      />
    );
  }

  if (!renderedCode) {
    return (
      <div style={{ maxWidth: 560, margin: "14vh auto", padding: 24, fontFamily: "system-ui" }}>
        <h1 style={{ fontSize: 26 }}>Build your homepage</h1>
        <p style={{ color: "#555", lineHeight: 1.6 }}>
          The agent reads your browsing history, opens the pages you actually follow, and writes a
          homepage from what it finds today.
        </p>
        {noticeProps && <UsageLimitNotice variant="panel" {...noticeProps} />}
        {!noticeProps && state.error && (
          <div style={{ ...errorBox, margin: "16px 0", padding: 12, borderRadius: 4 }}>
            {state.error}
            <ActivityLog logs={state.logs} />
          </div>
        )}
        <div style={{ display: "flex", gap: 12, marginTop: 16, alignItems: "center" }}>
          <button style={btn} onClick={() => build()}>
            Build today&apos;s homepage
          </button>
          {resumable && (
            <button style={{ ...btn, backgroundColor: "#555" }} onClick={() => build({ resume: true })}>
              Resume interrupted build
            </button>
          )}
          <button style={{ ...btn, backgroundColor: "white", color: "#333", border: "1px solid #ddd" }} onClick={() => setShowSettings(true)}>
            ⚙️ Settings
          </button>
        </div>
        {settingsModal}
      </div>
    );
  }

  const showError = state.error && dismissedError !== state.error;

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      <div style={{ position: "fixed", top: 20, right: 20, zIndex: 999, display: "flex", gap: 8 }}>
        {state.running ? (
          // A build is running in the background (from here, another tab, or the
          // scheduled rebuild). Let the user watch it without losing this page.
          <button
            style={{ ...btn, backgroundColor: "#0a7", display: "flex", alignItems: "center", gap: 8 }}
            onClick={() => setViewProgress(true)}
            title="View build progress"
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "white",
                animation: "hb-pulse 1.2s ease-in-out infinite",
              }}
            />
            Building… {Math.min(state.stepIndex + 1, BUILD_STEPS.length)}/{BUILD_STEPS.length}
          </button>
        ) : (
          <button style={btn} onClick={() => build()} title="Rebuild now">
            ↻ Rebuild
          </button>
        )}
        <button style={btn} onClick={() => setShowSettings(true)} title="Customize homepage">
          ⚙️ Settings
        </button>
      </div>

      {noticeProps && <UsageLimitNotice variant="banner" onDismiss={dismissNotice} {...noticeProps} />}

      {!noticeProps && showError && (
        <div
          style={{
            ...errorBox,
            position: "fixed",
            top: 20,
            left: 20,
            right: 260,
            zIndex: 999,
            padding: "10px 14px",
            borderRadius: 6,
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <span style={{ flex: 1 }}>
            <b>Build failed.</b> {state.error}
            <ActivityLog logs={state.logs} />
          </span>
          <button style={{ ...btn, padding: "4px 10px", backgroundColor: "#a02620" }} onClick={() => build()}>
            Retry
          </button>
          <button
            onClick={() => setDismissedError(state.error)}
            style={{
              background: "transparent",
              border: "none",
              color: "#a02620",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
            }}
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <HomepagePreview code={renderedCode} />

      {settingsModal}
    </div>
  );
}

/** The tail of the worker's log, folded under an error so a failure can be reported with context. */
function ActivityLog({ logs }: { logs: string[] }) {
  if (logs.length === 0) return null;
  return (
    <details style={{ marginTop: 8 }}>
      <summary style={{ cursor: "pointer", fontSize: 12 }}>Activity log ({logs.length} lines)</summary>
      <pre
        style={{
          margin: "6px 0 0",
          padding: 8,
          background: "rgba(0,0,0,0.04)",
          borderRadius: 4,
          fontSize: 11,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          maxHeight: 240,
          overflow: "auto",
        }}
      >
        {logs.slice(-25).join("\n")}
      </pre>
    </details>
  );
}
