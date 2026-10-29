import { useEffect, useState } from "react";
import { ENGINES, MODEL_CHOICES, SKINS, findSkin, normalizeBlockList, type EngineId, type HomepageModel, type SkinId } from "@homepage/agent-core";
import type { AuthState } from "@/lib/protocol";
import type { ClaudeApiMode, LinkTarget } from "@/lib/storage";
import type { ModelsState } from "../useHomepageBuild";
import { btn, btnQuiet } from "./ui";

const selectStyle = { padding: "4px 8px", fontSize: 14, borderRadius: 4, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--fg)" } as const;
const quiet = { ...btnQuiet, padding: "4px 10px" } as const;

export function SettingsModal({
  initialPrompt,
  blockedSites,
  auth,
  onChangeEngine,
  model,
  onChangeModel,
  claudeApiMode,
  onChangeClaudeApiMode,
  onChangeOpenAIMode,
  openaiModel,
  models,
  onLoadModels,
  onChangeOpenAIModel,
  onForgetKey,
  onSignOut,
  skin,
  onChangeSkin,
  linkTarget,
  onChangeLinkTarget,
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
  /** Claude: Managed Agents (standard price) or the Message Batches API (half price, slower). */
  claudeApiMode: ClaudeApiMode;
  onChangeClaudeApiMode: (next: ClaudeApiMode) => void;
  onChangeOpenAIMode: (next: AuthState["openai"]["mode"]) => void;
  openaiModel: string | null;
  models: ModelsState;
  onLoadModels: (opts?: { refresh?: boolean }) => void;
  onChangeOpenAIModel: (next: string) => void;
  /** Remove the current engine's API key (returns to the setup screen). */
  onForgetKey: () => void;
  onSignOut: (opts?: { forget?: boolean }) => void;
  /** The look applied over the generated page (instant, no rebuild); null = the agent's own. */
  skin: SkinId | null;
  onChangeSkin: (next: SkinId | null) => void;
  linkTarget: LinkTarget;
  onChangeLinkTarget: (next: LinkTarget) => void;
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
        backgroundColor: "var(--overlay)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ backgroundColor: "var(--bg)", color: "var(--fg)", borderRadius: 8, padding: 24, width: "90%", maxWidth: 600, maxHeight: "90vh", overflowY: "auto" }}>
        <h2 style={{ marginTop: 0 }}>Customize your homepage</h2>
        <p style={{ color: "var(--muted)" }}>Standing instructions applied to every build.</p>
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
            border: "1px solid var(--border)",
            background: "var(--panel)",
            color: "var(--fg)",
            fontFamily: "inherit",
          }}
        />
        <label style={{ display: "block", marginTop: 16, fontSize: 14 }}>
          Sites the agent never reads
          <textarea
            value={blockedDraft}
            onChange={(e) => setBlockedDraft(e.target.value)}
            aria-describedby="blocked-sites-help"
            style={{ width: "100%", boxSizing: "border-box", minHeight: 120, marginTop: 8, padding: 12, fontSize: 14, borderRadius: 4, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--fg)", fontFamily: "inherit" }}
          />
        </label>
        <p id="blocked-sites-help" style={{ color: "var(--faint)", fontSize: 12, margin: "6px 0 0" }}>
          One per line. Subdomains are included. Use *.example.com for wildcards.
        </p>

        {/* ---- look ----------------------------------------------------- */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
            Look
            <select value={skin ?? ""} onChange={(e) => onChangeSkin(findSkin(e.target.value)?.id ?? null)} style={selectStyle}>
              <option value="">As the agent built it</option>
              {SKINS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <p style={{ color: "var(--faint)", fontSize: 12, margin: "6px 0 0" }}>
            {findSkin(skin)?.description ??
              "A look re-dresses the page instantly: typography, palette and rules change, the stories stay. Pages built before this version follow it from their next build."}
          </p>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 14 }}>
            Links open in
            <select value={linkTarget} onChange={(e) => onChangeLinkTarget(e.target.value === "sameTab" ? "sameTab" : "newTab")} style={selectStyle}>
              <option value="newTab">a new tab</option>
              <option value="sameTab">this tab</option>
            </select>
          </label>
          <p style={{ color: "var(--faint)", fontSize: 12, margin: "6px 0 0" }}>
            Cmd/Ctrl-click and the middle button always open a background tab.
          </p>
        </div>

        {/* ---- engine --------------------------------------------------- */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--fg)", fontSize: 14 }}>
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
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, color: "var(--fg)", fontSize: 14 }}>
                Model
                <select value={model} onChange={(e) => onChangeModel(e.target.value as HomepageModel)} style={selectStyle}>
                  {MODEL_CHOICES.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label
                style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, color: "var(--fg)", fontSize: 14, cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  data-testid="claude-batch-toggle"
                  checked={claudeApiMode === "batch"}
                  onChange={(e) => onChangeClaudeApiMode(e.target.checked ? "batch" : "managed")}
                />
                Use the Message Batches API: half price, slower
              </label>
              <p style={{ color: "var(--faint)", fontSize: 12, margin: "6px 0 0" }}>
                {claudeApiMode === "batch"
                  ? "Every step of the build waits in Anthropic's batch queue, usually a few minutes, at most 24 hours. The build carries on in the background and the homepage appears when it is done."
                  : "Off: builds run as a Managed Agents session at the standard price, in a few minutes."}
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, fontSize: 14, color: "var(--fg)" }}>
                <span style={{ flex: 1 }}>Anthropic API key: <b>{auth.claudeReady ? "saved" : "missing"}</b></span>
                <button onClick={onForgetKey} style={quiet}>
                  {auth.claudeReady ? "Change key" : "Add key"}
                </button>
              </div>
            </>
          )}

          {openai && (
            <>
              <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 14, color: "var(--fg)" }}>
                <label style={{ cursor: "pointer" }}>
                  <input type="radio" checked={auth.openai.mode === "siwc"} onChange={() => onChangeOpenAIMode("siwc")} /> ChatGPT plan
                </label>
                <label style={{ cursor: "pointer" }}>
                  <input type="radio" checked={auth.openai.mode === "apiKey"} onChange={() => onChangeOpenAIMode("apiKey")} /> API key
                </label>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, color: "var(--fg)", fontSize: 14 }}>
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
              <p style={{ color: models.error ? "var(--danger-fg)" : "var(--faint)", fontSize: 12, margin: "6px 0 0" }}>
                {models.error ?? "Models your credentials offer, in OpenAI's order. The new model takes effect from your next build."}
              </p>

              {auth.openai.mode === "apiKey" ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, fontSize: 14, color: "var(--fg)" }}>
                  <span style={{ flex: 1 }}>OpenAI API key: <b>{auth.openai.apiKeySaved ? "saved" : "missing"}</b></span>
                  <button onClick={onForgetKey} style={quiet}>
                    {auth.openai.apiKeySaved ? "Change key" : "Add key"}
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, fontSize: 14, color: "var(--fg)" }}>
                    <span style={{ flex: 1 }}>
                      ChatGPT account: <b>{auth.openai.signedIn ? auth.openai.email ?? "signed in" : "not signed in"}</b>
                      {auth.openai.signedIn && !auth.openai.planUsage && <span style={{ color: "var(--danger-fg)" }}> (plan usage not granted)</span>}
                    </span>
                    {auth.openai.signedIn && (
                      <>
                        <button onClick={() => onSignOut()} style={quiet}>
                          Sign out
                        </button>
                        <button
                          onClick={() => onSignOut({ forget: true })}
                          title="Sign out and forget this app's registration, so the next sign-in can use another account"
                          style={{ ...quiet, color: "var(--danger-fg)" }}
                        >
                          Switch account
                        </button>
                      </>
                    )}
                  </div>
                  <p style={{ color: "var(--faint)", fontSize: 12, margin: "6px 0 0" }}>
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
            borderTop: "1px solid var(--border)",
            color: "var(--fg)",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          <input type="checkbox" checked={autoRebuild} onChange={(e) => onToggleAutoRebuild(e.target.checked)} />
          Rebuild automatically each morning
        </label>
        <p style={{ color: "var(--faint)", fontSize: 12, margin: "6px 0 0" }}>
          When on, the extension builds one morning edition a day in the background (first time
          Chrome is open between 5am and noon), so your next tab shows a fresh one (uses your key or plan).
        </p>

        <div style={{ display: "flex", gap: 12, marginTop: 20, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={btnQuiet}>
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
