import type { AuthState } from "@/lib/protocol";
import { useI18n } from "../i18n";
import { btn, btnQuiet, errorBox } from "./ui";

/**
 * The first screen, and the one shown again after a sign-out or a revoked
 * session. The button label follows OpenAI's Sign in with ChatGPT guidelines.
 */
export function SignIn({
  auth,
  onSignIn,
  onCancel,
}: {
  auth: AuthState["openai"];
  onSignIn: (opts?: { newAccount?: boolean }) => void;
  onCancel: () => void;
}) {
  const { t, rich } = useI18n();
  return (
    <div>
      <h2 style={{ fontSize: 20, marginTop: 0 }}>{t("signIn.title")}</h2>
      <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>{rich("signIn.body", { code: (text) => <code>{text}</code> })}</p>
      <p style={{ color: "var(--muted)", lineHeight: 1.6, fontSize: 14 }}>{t("signIn.howItWorks")}</p>

      {auth.error && (
        <div style={{ ...errorBox, margin: "16px 0", padding: 12, borderRadius: 4 }}>{auth.error}</div>
      )}

      {auth.pending ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "var(--success)",
              animation: "hb-pulse 1.2s ease-in-out infinite",
            }}
          />
          <span>{t("signIn.waiting")}</span>
          <button style={btnQuiet} onClick={onCancel}>
            {t("common.cancel")}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 16 }}>
          <button style={{ ...btn, backgroundColor: "var(--fg)", color: "var(--bg)", padding: "10px 18px" }} onClick={() => onSignIn()}>
            {t("signIn.continue")}
          </button>
          <button
            style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 13 }}
            onClick={() => onSignIn({ newAccount: true })}
            title={t("signIn.otherAccountTitle")}
          >
            {t("signIn.otherAccount")}
          </button>
        </div>
      )}
    </div>
  );
}
