import { useEffect, useState } from "react";
import { ENGINES, MODEL_CHOICES, normalizeBlockList, type EngineId, type HomepageModel } from "@homepage/agent-core";
import type { AuthState } from "@/lib/protocol";
import type { ModelsState } from "../useHomepageBuild";
import { btn } from "./ui";

const selectStyle = { padding: "4px 8px", fontSize: 14, borderRadius: 4, border: "1px solid #ddd" } as const;
const quiet = { ...btn, padding: "4px 10px", backgroundColor: "white", color: "#333", border: "1px solid #ddd" } as const;

export function SettingsModal({
  initialPrompt,
  blockedSites,
  auth,
  onChangeEngine,
  model,
  onChangeModel,
  onChangeOpenAIMode,
  openaiModel,
  models,
  onLoadModels,
  onChangeOpenAIModel,
  onForgetKey,
  onSignOut,
  autoRebuild,
  onToggleAutoRebuild,
  onClose,
  onSave,
}: {
  initialPrompt: string;
  blockedSites: string[];
  auth: AuthState;
  onChangeEngine: (next: EngineId) => void;
  /** Claude model. */
  model: HomepageModel;
  onChangeModel: (next: HomepageModel) => void;
  onChangeOpenAIMode: (next: AuthState["openai"]["mode"]) => void;
  openaiModel: string | null;
  models: ModelsState;
  onLoadModels: (opts?: { refresh?: boolean }) => void;
  onChangeOpenAIModel: (next: string) => void;
  /** Remove the current engine's API key (returns to the setup screen). */
  onForgetKey: () => void;
  onSignOut: (opts?: { forget?: boolean }) => void;
  autoRebuild: boolean;
  onToggleAutoRebuild: (next: boolean) => void;
  onClose: () => void;
  onSave: (prompt: string, blockedSites: string[]) => void;
}) {
  const [draft, setDraft] = useState(initialPrompt);
  const [blockedDraft, setBlockedDraft] = useState(blockedSites.join("\n"));
  const openai = auth.engine === "openai";

  // The OpenAI list comes from GET /models with the credentials in use (cached by the worker).
  useEffect(() => {
    if (openai && auth.ready) onLoadModels();
  }, [openai, auth.ready, auth.openai.mode, onLoadModels]);

  const effectiveOpenAIModel =
    openaiModel && models.models.some((m) => m.slug === openaiModel) ? openaiModel : models.models[0]?.slug ?? openaiModel ?? "";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ backgroundColor: "white", borderRadius: 8, padding: 24, width: "90%", maxWidth: 600, maxHeight: "90vh", overflowY: "auto" }}>
        <h2 style={{ marginTop: 0, color: "#333" }}>Customize your homepage</h2>
        <p style={{ color: "#666" }}>Standing instructions applied to every build.</p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. 'Focus on tech news and Rust releases', 'Always surface unread GitHub PRs first'"
          style={{
            width: "100%",
            minHeight: 200,
            padding: 12,
            fontSize: 14,
            borderRadius: 4,
            border: "1px solid #ddd",
            fontFamily: "inherit",
          }}
        />
        <label style={{ display: "block", marginTop: 16, color: "#333", fontSize: 14 }}>
          Sites the agent never reads
          <textarea
            value={blockedDraft}
            onChange={(e) => setBlockedDraft(e.target.value)}
            aria-describedby="blocked-sites-help"
            style={{ width: "100%", boxSizing: "border-box", minHeight: 120, marginTop: 8, padding: 12, fontSize: 14, borderRadius: 4, border: "1px solid #ddd", fontFamily: "inherit" }}
          />
        </label>
        <p id="blocked-sites-help" style={{ color: "#888", fontSize: 12, margin: "6px 0 0" }}>
          One per line. Subdomains are included. Use *.example.com for wildcards.
        </p>

        {/* ---- engine --------------------------------------------------- */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #eee" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#333", fontSize: 14 }}>
            Engine
            <select value={auth.engine} onChange={(e) => onChangeEngine(e.target.value as EngineId)} style={selectStyle}>
              {ENGINES.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>

          {!openai && (
            <>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, color: "#333", fontSize: 14 }}>
                Model
                <select value={model} onChange={(e) => onChangeModel(e.target.value as HomepageModel)} style={selectStyle}>
                  {MODEL_CHOICES.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, fontSize: 14, color: "#333" }}>
                <span style={{ flex: 1 }}>Anthropic API key: <b>{auth.claudeReady ? "saved" : "missing"}</b></span>
                <button onClick={onForgetKey} style={quiet}>
                  {auth.claudeReady ? "Change key" : "Add key"}
                </button>
              </div>
            </>
          )}

          {openai && (
            <>
              <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 14, color: "#333" }}>
                <label style={{ cursor: "pointer" }}>
                  <input type="radio" checked={auth.openai.mode === "siwc"} onChange={() => onChangeOpenAIMode("siwc")} /> ChatGPT plan
                </label>
                <label style={{ cursor: "pointer" }}>
                  <input type="radio" checked={auth.openai.mode === "apiKey"} onChange={() => onChangeOpenAIMode("apiKey")} /> API key
                </label>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, color: "#333", fontSize: 14 }}>
                Model
                <select
                  value={effectiveOpenAIModel}
                  onChange={(e) => onChangeOpenAIModel(e.target.value)}
                  disabled={models.models.length === 0}
                  style={selectStyle}
                >
                  {models.models.length === 0 && (
                    <option value={effectiveOpenAIModel}>{models.loading ? "Loading…" : effectiveOpenAIModel || "No models listed"}</option>
                  )}
                  {models.models.map((m) => (
                    <option key={m.slug} value={m.slug}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
                <button onClick={() => onLoadModels({ refresh: true })} disabled={models.loading || !auth.ready} title="Fetch the models these credentials offer" style={quiet}>
                  ↻
                </button>
              </label>
              <p style={{ color: models.error ? "#a02620" : "#888", fontSize: 12, margin: "6px 0 0" }}>
                {models.error ?? "Models your credentials offer, in OpenAI's order. The new model takes effect from your next build."}
              </p>

              {auth.openai.mode === "apiKey" ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, fontSize: 14, color: "#333" }}>
                  <span style={{ flex: 1 }}>OpenAI API key: <b>{auth.openai.apiKeySaved ? "saved" : "missing"}</b></span>
                  <button onClick={onForgetKey} style={quiet}>
                    {auth.openai.apiKeySaved ? "Change key" : "Add key"}
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, fontSize: 14, color: "#333" }}>
                    <span style={{ flex: 1 }}>
                      ChatGPT account: <b>{auth.openai.signedIn ? auth.openai.email ?? "signed in" : "not signed in"}</b>
                      {auth.openai.signedIn && !auth.openai.planUsage && <span style={{ color: "#a02620" }}> (plan usage not granted)</span>}
                    </span>
                    {auth.openai.signedIn && (
                      <>
                        <button onClick={() => onSignOut()} style={quiet}>
                          Sign out
                        </button>
                        <button
                          onClick={() => onSignOut({ forget: true })}
                          title="Sign out and forget this app's registration, so the next sign-in can use another account"
                          style={{ ...quiet, color: "#a02620" }}
                        >
                          Switch account
                        </button>
                      </>
                    )}
                  </div>
                  <p style={{ color: "#888", fontSize: 12, margin: "6px 0 0" }}>
                    Usage counts against your ChatGPT plan. Review it at{" "}
                    <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">chatgpt.com/settings/usage</a>.
                  </p>
                </>
              )}
            </>
          )}
        </div>

        {/* ---- schedule ------------------------------------------------- */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 20,
            paddingTop: 16,
            borderTop: "1px solid #eee",
            color: "#333",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          <input type="checkbox" checked={autoRebuild} onChange={(e) => onToggleAutoRebuild(e.target.checked)} />
          Rebuild automatically each morning
        </label>
        <p style={{ color: "#888", fontSize: 12, margin: "6px 0 0" }}>
          When on, the extension builds one morning edition a day in the background (first time
          Chrome is open between 5am and noon), so your next tab shows a fresh one (uses your key or plan).
        </p>

        <div style={{ display: "flex", gap: 12, marginTop: 20, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ ...btn, backgroundColor: "white", color: "#333", border: "1px solid #ddd" }}>
            Cancel
          </button>
          <button onClick={() => onSave(draft, normalizeBlockList(blockedDraft.split("\n")))} style={btn}>
            Save &amp; rebuild
          </button>
        </div>
      </div>
    </div>
  );
}
