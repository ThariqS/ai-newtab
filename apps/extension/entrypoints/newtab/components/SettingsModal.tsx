import { useEffect, useState } from "react";
import { ENGINES, MODEL_CHOICES, SKINS, findSkin, normalizeBlockList, type EngineId, type HomepageModel, type SkinId } from "@homepage/agent-core";
import type { AuthState } from "@/lib/protocol";
import type { ClaudeApiMode, LinkTarget } from "@/lib/storage";
import { useI18n } from "../i18n";
import type { ModelsState } from "../useHomepageBuild";
import { LanguagePicker } from "./LanguagePicker";
import { btn, btnQuiet, selectStyle } from "./ui";

const quiet = { ...btnQuiet, padding: "4px 10px" } as const;
const help = { color: "var(--faint)", fontSize: 12, margin: "6px 0 0" } as const;

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
  const { t, rich } = useI18n();
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
        <h2 style={{ marginTop: 0 }}>{t("settings.title")}</h2>
        <p style={{ color: "var(--muted)" }}>{t("settings.instructions.help")}</p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("settings.instructions.placeholder")}
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
          {t("settings.blocked.label")}
          <textarea
            value={blockedDraft}
            onChange={(e) => setBlockedDraft(e.target.value)}
            aria-describedby="blocked-sites-help"
            style={{ width: "100%", boxSizing: "border-box", minHeight: 120, marginTop: 8, padding: 12, fontSize: 14, borderRadius: 4, border: "1px solid var(--border)", background: "var(--panel)", color: "var(--fg)", fontFamily: "inherit" }}
          />
        </label>
        <p id="blocked-sites-help" style={help}>
          {t("settings.blocked.help")}
        </p>

        {/* ---- language and look ----------------------------------------- */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <LanguagePicker />
          <p style={help}>{t("settings.language.help")}</p>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 14 }}>
            {t("settings.look.label")}
            <select value={skin ?? ""} onChange={(e) => onChangeSkin(findSkin(e.target.value)?.id ?? null)} style={selectStyle}>
              <option value="">{t("settings.look.agent")}</option>
              {SKINS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <p style={help}>{skin ? t(`look.${skin}`) : t("settings.look.help")}</p>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 14 }}>
            {t("settings.links.label")}
            <select value={linkTarget} onChange={(e) => onChangeLinkTarget(e.target.value === "sameTab" ? "sameTab" : "newTab")} style={selectStyle}>
              <option value="newTab">{t("settings.links.newTab")}</option>
              <option value="sameTab">{t("settings.links.sameTab")}</option>
            </select>
          </label>
          <p style={help}>{t("settings.links.help")}</p>
        </div>

        {/* ---- engine --------------------------------------------------- */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--fg)", fontSize: 14 }}>
            {t("settings.engine.label")}
            <select value={auth.engine} onChange={(e) => onChangeEngine(e.target.value as EngineId)} style={selectStyle}>
              {ENGINES.map((e) => (
                <option key={e.id} value={e.id}>
                  {t(`engine.${e.id}`)}
                </option>
              ))}
            </select>
          </label>

          {!openai && (
            <>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, color: "var(--fg)", fontSize: 14 }}>
                {t("settings.model.label")}
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
                {t("settings.batch.label")}
              </label>
              <p style={help}>{t(claudeApiMode === "batch" ? "settings.batch.on" : "settings.batch.off")}</p>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, fontSize: 14, color: "var(--fg)" }}>
                <span style={{ flex: 1 }}>
                  {rich("settings.key.anthropic", bold, { status: t(auth.claudeReady ? "settings.key.saved" : "settings.key.missing") })}
                </span>
                <button onClick={onForgetKey} style={quiet}>
                  {t(auth.claudeReady ? "settings.key.change" : "settings.key.add")}
                </button>
              </div>
            </>
          )}

          {openai && (
            <>
              <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 14, color: "var(--fg)" }}>
                <label style={{ cursor: "pointer" }}>
                  <input type="radio" checked={auth.openai.mode === "siwc"} onChange={() => onChangeOpenAIMode("siwc")} />{" "}
                  {t("settings.openai.plan")}
                </label>
                <label style={{ cursor: "pointer" }}>
                  <input type="radio" checked={auth.openai.mode === "apiKey"} onChange={() => onChangeOpenAIMode("apiKey")} />{" "}
                  {t("settings.openai.apiKey")}
                </label>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, color: "var(--fg)", fontSize: 14 }}>
                {t("settings.model.label")}
                <select
                  value={effectiveOpenAIModel}
                  onChange={(e) => onChangeOpenAIModel(e.target.value)}
                  disabled={models.models.length === 0}
                  style={selectStyle}
                >
                  {models.models.length === 0 && (
                    <option value={effectiveOpenAIModel}>
                      {models.loading ? t("app.loading") : effectiveOpenAIModel || t("settings.model.none")}
                    </option>
                  )}
                  {models.models.map((m) => (
                    <option key={m.slug} value={m.slug}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
                <button onClick={() => onLoadModels({ refresh: true })} disabled={models.loading || !auth.ready} title={t("settings.model.refresh")} style={quiet}>
                  ↻
                </button>
              </label>
              <p style={{ ...help, color: models.error ? "var(--danger-fg)" : "var(--faint)" }}>
                {models.error ?? t("settings.model.help")}
              </p>

              {auth.openai.mode === "apiKey" ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, fontSize: 14, color: "var(--fg)" }}>
                  <span style={{ flex: 1 }}>
                    {rich("settings.key.openai", bold, { status: t(auth.openai.apiKeySaved ? "settings.key.saved" : "settings.key.missing") })}
                  </span>
                  <button onClick={onForgetKey} style={quiet}>
                    {t(auth.openai.apiKeySaved ? "settings.key.change" : "settings.key.add")}
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, fontSize: 14, color: "var(--fg)" }}>
                    <span style={{ flex: 1 }}>
                      {rich("settings.chatgpt.account", bold, {
                        account: auth.openai.signedIn
                          ? auth.openai.email ?? t("settings.chatgpt.signedIn")
                          : t("settings.chatgpt.notSignedIn"),
                      })}
                      {auth.openai.signedIn && !auth.openai.planUsage && (
                        <span style={{ color: "var(--danger-fg)" }}> {t("settings.chatgpt.noPlanUsage")}</span>
                      )}
                    </span>
                    {auth.openai.signedIn && (
                      <>
                        <button onClick={() => onSignOut()} style={quiet}>
                          {t("common.signOut")}
                        </button>
                        <button
                          onClick={() => onSignOut({ forget: true })}
                          title={t("settings.chatgpt.switchTitle")}
                          style={{ ...quiet, color: "var(--danger-fg)" }}
                        >
                          {t("settings.chatgpt.switch")}
                        </button>
                      </>
                    )}
                  </div>
                  <p style={help}>
                    {rich("settings.chatgpt.usage", {
                      link: (text) => (
                        <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">
                          {text}
                        </a>
                      ),
                    })}
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
          {t("settings.auto.label")}
        </label>
        <p style={help}>{t("settings.auto.help")}</p>

        <div style={{ display: "flex", gap: 12, marginTop: 20, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={btnQuiet}>
            {t("common.cancel")}
          </button>
          <button onClick={() => onSave(draft, normalizeBlockList(blockedDraft.split("\n")))} style={btn}>
            {t("settings.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

const bold = { b: (text: string) => <b>{text}</b> };
