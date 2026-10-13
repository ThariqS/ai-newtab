import type { EngineId } from "@homepage/agent-core";
import type { AuthState } from "@/lib/protocol";
import { ApiKeySetup } from "./ApiKeySetup";
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
      <h1 style={{ fontSize: 24 }}>Choose who writes your homepage</h1>
      <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>
        Each build is one agent run. Pick the engine, then connect it. You can switch later in Settings.
      </p>

      <div style={{ display: "flex", gap: 12, margin: "16px 0" }}>
        <button style={choice(auth.engine === "claude")} onClick={() => onChooseEngine("claude")}>
          <b>Claude</b>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>Anthropic API key, billed per build</div>
        </button>
        <button style={choice(auth.engine === "openai")} onClick={() => onChooseEngine("openai")}>
          <b>OpenAI</b>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>Your ChatGPT plan, or an API key</div>
        </button>
      </div>

      {auth.engine === "openai" && (
        <div style={{ display: "flex", gap: 16, margin: "0 0 20px", fontSize: 14 }}>
          <label style={{ cursor: "pointer" }}>
            <input type="radio" checked={auth.openai.mode === "siwc"} onChange={() => onChooseOpenAIMode("siwc")} />{" "}
            Use my ChatGPT plan (Sign in with ChatGPT)
          </label>
          <label style={{ cursor: "pointer" }}>
            <input type="radio" checked={auth.openai.mode === "apiKey"} onChange={() => onChooseOpenAIMode("apiKey")} />{" "}
            Use an OpenAI API key
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
    </div>
  );
}
