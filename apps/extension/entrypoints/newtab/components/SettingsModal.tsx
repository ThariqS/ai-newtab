import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ENGINES, MODEL_CHOICES, SKINS, findSkin, normalizeBlockList, type EngineId, type HomepageModel, type SkinId } from "@homepage/agent-core";
import type { AuthState } from "@/lib/protocol";
import type { ClaudeApiMode, LinkTarget } from "@/lib/storage";
import { useI18n } from "../i18n";
import type { ModelsState } from "../useHomepageBuild";
import { LanguageSelect } from "./LanguagePicker";
import { btn, btnQuiet } from "./ui";

/**
 * Settings, built around the standing instructions: they take the middle of
 * the dialog and are saved with "Save & rebuild". Everything that applies at
 * once (display, agent, schedule) sits in the side column, and the block list,
 * set once and rarely touched, folds away under the instructions.
 */
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
  const instructionsRef = useRef<HTMLTextAreaElement>(null);
  const openai = auth.engine === "openai";

  // The OpenAI list comes from GET /models with the credentials in use (cached by the worker).
  useEffect(() => {
    if (openai && auth.ready) onLoadModels();
  }, [openai, auth.ready, auth.openai.mode, onLoadModels]);

  // Open on the instructions, caret at the end, ready to type.
  useEffect(() => {
    const field = instructionsRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);

  // Only the instructions and the block list wait for "Save & rebuild"; ask before dropping edits to them.
  const dirty = draft !== initialPrompt || blockedDraft !== blockedSites.join("\n");
  const requestClose = useCallback(() => {
    if (!dirty || window.confirm(t("settings.discard"))) onClose();
  }, [dirty, onClose, t]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  const blockedCount = blockedDraft.split("\n").filter((line) => line.trim()).length;
  const effectiveOpenAIModel =
    openaiModel && models.models.some((m) => m.slug === openaiModel) ? openaiModel : models.models[0]?.slug ?? openaiModel ?? "";

  return (
    <div className="settings-backdrop" onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
      <div className="settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="settings-head">
          <h2 id="settings-title">{t("settings.title")}</h2>
          <button type="button" className="settings-close" onClick={requestClose} aria-label={t("common.close")} title={t("common.close")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="settings-body">
          {/* ---- the instructions, and the sites the agent never reads ---- */}
          <section className="settings-main">
            <label htmlFor="settings-instructions" className="settings-label">
              {t("settings.instructions.label")}
            </label>
            <p id="settings-instructions-help" className="settings-hint">
              {t("settings.instructions.help")} {t("settings.instructions.languageTip")}
            </p>
            <textarea
              id="settings-instructions"
              ref={instructionsRef}
              className="settings-instructions"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("settings.instructions.placeholder")}
              aria-describedby="settings-instructions-help"
            />
            <details className="settings-disclosure">
              <summary>
                {t("settings.blocked.label")}
                <span className="settings-count">{t("settings.blocked.count", { count: blockedCount })}</span>
              </summary>
              <textarea
                className="settings-sites"
                value={blockedDraft}
                onChange={(e) => setBlockedDraft(e.target.value)}
                aria-label={t("settings.blocked.label")}
                aria-describedby="blocked-sites-help"
              />
              <p id="blocked-sites-help" className="settings-hint">
                {t("settings.blocked.help")}
              </p>
            </details>
          </section>

          {/* ---- what applies at once ---- */}
          <aside className="settings-side">
            <p className="settings-hint">{t("settings.applyNow")}</p>

            <Group title={t("settings.group.display")}>
              <Row id="settings-language" label={t("settings.language.label")}>
                <LanguageSelect id="settings-language" />
              </Row>
              <Row id="settings-look" label={t("settings.look.label")}>
                <select id="settings-look" value={skin ?? ""} onChange={(e) => onChangeSkin(findSkin(e.target.value)?.id ?? null)}>
                  <option value="">{t("settings.look.agent")}</option>
                  {SKINS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Row>
              <p className="settings-hint">{skin ? t(`look.${skin}`) : t("settings.look.help")}</p>
              <Row id="settings-links" label={t("settings.links.label")}>
                <select
                  id="settings-links"
                  value={linkTarget}
                  title={t("settings.links.help")}
                  onChange={(e) => onChangeLinkTarget(e.target.value === "sameTab" ? "sameTab" : "newTab")}
                >
                  <option value="newTab">{t("settings.links.newTab")}</option>
                  <option value="sameTab">{t("settings.links.sameTab")}</option>
                </select>
              </Row>
            </Group>

            <Group title={t("settings.group.agent")}>
              <Row id="settings-engine" label={t("settings.engine.label")}>
                <select id="settings-engine" value={auth.engine} onChange={(e) => onChangeEngine(e.target.value as EngineId)}>
                  {ENGINES.map((e) => (
                    <option key={e.id} value={e.id}>
                      {t(`engine.${e.id}`)}
                    </option>
                  ))}
                </select>
              </Row>

              {!openai && (
                <>
                  <Row id="settings-model" label={t("settings.model.label")}>
                    <select id="settings-model" value={model} onChange={(e) => onChangeModel(e.target.value as HomepageModel)}>
                      {MODEL_CHOICES.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </Row>
                  <label className="settings-check">
                    <input
                      type="checkbox"
                      data-testid="claude-batch-toggle"
                      checked={claudeApiMode === "batch"}
                      onChange={(e) => onChangeClaudeApiMode(e.target.checked ? "batch" : "managed")}
                    />
                    <span>
                      {t("settings.batch.label")}
                      <span className="settings-hint" style={{ display: "block", marginTop: 2 }}>
                        {t(claudeApiMode === "batch" ? "settings.batch.on" : "settings.batch.off")}
                      </span>
                    </span>
                  </label>
                  <div className="settings-cred">
                    <span>{rich("settings.key.anthropic", bold, { status: t(auth.claudeReady ? "settings.key.saved" : "settings.key.missing") })}</span>
                    <button type="button" className="settings-link-btn" onClick={onForgetKey}>
                      {t(auth.claudeReady ? "settings.key.change" : "settings.key.add")}
                    </button>
                  </div>
                </>
              )}

              {openai && (
                <>
                  <div className="settings-segmented" role="radiogroup" aria-label={t("engine.openai")}>
                    <label>
                      <input type="radio" name="openai-mode" checked={auth.openai.mode === "siwc"} onChange={() => onChangeOpenAIMode("siwc")} />
                      {t("settings.openai.plan")}
                    </label>
                    <label>
                      <input type="radio" name="openai-mode" checked={auth.openai.mode === "apiKey"} onChange={() => onChangeOpenAIMode("apiKey")} />
                      {t("settings.openai.apiKey")}
                    </label>
                  </div>
                  <Row id="settings-openai-model" label={t("settings.model.label")}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <select
                        id="settings-openai-model"
                        className="settings-select"
                        value={effectiveOpenAIModel}
                        onChange={(e) => onChangeOpenAIModel(e.target.value)}
                        disabled={models.models.length === 0}
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
                      <button
                        type="button"
                        className="settings-icon-btn"
                        onClick={() => onLoadModels({ refresh: true })}
                        disabled={models.loading || !auth.ready}
                        title={t("settings.model.refresh")}
                        aria-label={t("settings.model.refresh")}
                      >
                        ↻
                      </button>
                    </div>
                  </Row>
                  {models.error && (
                    <p className="settings-hint" role="alert" style={{ color: "var(--danger-fg)" }}>
                      {models.error}
                    </p>
                  )}

                  {auth.openai.mode === "apiKey" ? (
                    <div className="settings-cred">
                      <span>
                        {rich("settings.key.openai", bold, { status: t(auth.openai.apiKeySaved ? "settings.key.saved" : "settings.key.missing") })}
                      </span>
                      <button type="button" className="settings-link-btn" onClick={onForgetKey}>
                        {t(auth.openai.apiKeySaved ? "settings.key.change" : "settings.key.add")}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="settings-cred">
                        <span>
                          {rich("settings.chatgpt.account", bold, {
                            account: auth.openai.signedIn
                              ? auth.openai.email ?? t("settings.chatgpt.signedIn")
                              : t("settings.chatgpt.notSignedIn"),
                          })}
                          {auth.openai.signedIn && !auth.openai.planUsage && (
                            <span style={{ color: "var(--danger-fg)" }}> {t("settings.chatgpt.noPlanUsage")}</span>
                          )}
                        </span>
                      </div>
                      {auth.openai.signedIn && (
                        <div className="settings-cred">
                          <button type="button" className="settings-link-btn" onClick={() => onSignOut()}>
                            {t("common.signOut")}
                          </button>
                          <button
                            type="button"
                            className="settings-link-btn danger"
                            onClick={() => onSignOut({ forget: true })}
                            title={t("settings.chatgpt.switchTitle")}
                          >
                            {t("settings.chatgpt.switch")}
                          </button>
                        </div>
                      )}
                      <p className="settings-hint">
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
            </Group>

            <Group title={t("settings.group.schedule")}>
              <label className="settings-check">
                <input type="checkbox" checked={autoRebuild} onChange={(e) => onToggleAutoRebuild(e.target.checked)} />
                <span>
                  {t("settings.auto.label")}
                  <span className="settings-hint" style={{ display: "block", marginTop: 2 }}>
                    {t("settings.auto.help")}
                  </span>
                </span>
              </label>
            </Group>
          </aside>
        </div>

        <footer className="settings-foot">
          <button type="button" onClick={requestClose} style={btnQuiet}>
            {t("common.cancel")}
          </button>
          <button type="button" onClick={() => onSave(draft, normalizeBlockList(blockedDraft.split("\n")))} style={btn}>
            {t("settings.save")}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-group">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/** A label beside its control; `id` ties them together. */
function Row({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <label htmlFor={id} style={{ color: "var(--muted)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const bold = { b: (text: string) => <b>{text}</b> };
