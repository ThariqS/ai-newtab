import type { EngineId } from "@homepage/agent-core";
import type { AuthState } from "@/lib/protocol";
import { useI18n } from "../i18n";
import { ApiKeySetup } from "./ApiKeySetup";
import { LanguagePicker } from "./LanguagePicker";
import { PlanUsageRequired } from "./PlanUsageRequired";
import { SignIn } from "./SignIn";

type OpenAIMode = AuthState["openai"]["mode"];

/**
 * The first screen: pick an engine and connect it. Shown again whenever the
 * chosen engine has no usable credentials (key removed, session revoked).
 */
export function Setup({
  auth,
  onChooseEngine,
  onChooseOpenAIMode,
  onSaveAnthropicKey,
  onSaveOpenAIKey,
  onSignIn,
  onCancelSignIn,
  onSignOut,
}: {
  auth: AuthState;
  onChooseEngine: (engine: EngineId) => void;
  onChooseOpenAIMode: (mode: OpenAIMode) => void;
  onSaveAnthropicKey: (key: string) => void;
  onSaveOpenAIKey: (key: string) => void;
  onSignIn: (opts?: { newAccount?: boolean; promptConsent?: boolean }) => void;
  onCancelSignIn: () => void;
  onSignOut: () => void;
}) {
  const { t } = useI18n();
  const choice = (selected: boolean) =>
    ({
      flex: 1,
      padding: "10px 14px",
      borderRadius: 6,
      border: selected ? "2px solid var(--accent)" : "1px solid var(--border)",
      background: selected ? "var(--accent-wash)" : "var(--panel)",
      color: "var(--fg)",
      cursor: "pointer",
      fontSize: 14,
      textAlign: "left",
    }) as const;

  return (
    <div style={{ maxWidth: 560, margin: "10vh auto", padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 24 }}>{t("setup.title")}</h1>
      <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>{t("setup.intro")}</p>

      <div style={{ display: "flex", gap: 12, margin: "16px 0" }}>
        <button style={choice(auth.engine === "claude")} onClick={() => onChooseEngine("claude")}>
          <b>Claude</b>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>{t("setup.claude.hint")}</div>
        </button>
        <button style={choice(auth.engine === "openai")} onClick={() => onChooseEngine("openai")}>
          <b>OpenAI</b>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>{t("setup.openai.hint")}</div>
        </button>
      </div>

      {auth.engine === "openai" && (
        <div style={{ display: "flex", gap: 16, margin: "0 0 20px", fontSize: 14 }}>
          <label style={{ cursor: "pointer" }}>
            <input type="radio" checked={auth.openai.mode === "siwc"} onChange={() => onChooseOpenAIMode("siwc")} />{" "}
            {t("setup.openai.plan")}
          </label>
          <label style={{ cursor: "pointer" }}>
            <input type="radio" checked={auth.openai.mode === "apiKey"} onChange={() => onChooseOpenAIMode("apiKey")} />{" "}
            {t("setup.openai.apiKey")}
          </label>
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 20 }}>
        {auth.engine === "claude" && <ApiKeySetup provider="anthropic" onSave={onSaveAnthropicKey} />}
        {auth.engine === "openai" && auth.openai.mode === "apiKey" && (
          <ApiKeySetup provider="openai" onSave={onSaveOpenAIKey} />
        )}
        {auth.engine === "openai" && auth.openai.mode === "siwc" && (
          auth.openai.signedIn && !auth.openai.planUsage ? (
            <PlanUsageRequired auth={auth.openai} onEnable={() => onSignIn({ promptConsent: true })} onSignOut={onSignOut} />
          ) : (
            <SignIn auth={auth.openai} onSignIn={onSignIn} onCancel={onCancelSignIn} />
          )
        )}
      </div>

      <LanguagePicker style={{ marginTop: 32, color: "var(--muted)" }} />
    </div>
  );
}
