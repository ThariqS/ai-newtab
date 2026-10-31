import type { AuthState } from "@/lib/protocol";
import { useI18n } from "../i18n";
import { btn, btnQuiet, errorBox } from "./ui";

/**
 * Signed in, but the `chatgpt.tokens.use.direct` scope was declined. Nothing
 * can be built until the user grants it, so say so and offer the re-consent.
 */
export function PlanUsageRequired({
  auth,
  onEnable,
  onSignOut,
}: {
  auth: AuthState["openai"];
  onEnable: () => void;
  onSignOut: () => void;
}) {
  const { t } = useI18n();
  return (
    <div>
      <h2 style={{ fontSize: 20, marginTop: 0 }}>{t("planUsage.title")}</h2>
      <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>
        {auth.email ? t("planUsage.bodyAs", { email: auth.email }) : t("planUsage.body")}
      </p>
      {auth.error && (
        <div style={{ ...errorBox, margin: "16px 0", padding: 12, borderRadius: 4 }}>{auth.error}</div>
      )}
      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <button style={{ ...btn, backgroundColor: "var(--fg)", color: "var(--bg)" }} onClick={onEnable} disabled={auth.pending}>
          {auth.pending ? t("planUsage.waiting") : t("planUsage.enable")}
        </button>
        <button style={btnQuiet} onClick={onSignOut}>
          {t("common.signOut")}
        </button>
      </div>
    </div>
  );
}
