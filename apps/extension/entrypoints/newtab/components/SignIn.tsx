import type { AuthState } from "@/lib/protocol";
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
  return (
    <div>
      <h2 style={{ fontSize: 20, marginTop: 0 }}>Sign in with ChatGPT</h2>
      <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>
        The agent runs inside this extension and talks to the OpenAI API with your ChatGPT plan
        (Plus or Pro), through Sign in with ChatGPT. No API key is needed. Your tokens are stored in{" "}
        <code>chrome.storage.local</code> on this machine and are never sent anywhere else.
      </p>
      <p style={{ color: "var(--muted)", lineHeight: 1.6, fontSize: 14 }}>
        A ChatGPT tab opens to sign in and approve this app. When it redirects back, this page
        picks the sign-in up automatically and the tab closes itself.
      </p>

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
          <span>Waiting for ChatGPT… finish signing in in the tab that opened.</span>
          <button style={btnQuiet} onClick={onCancel}>
            Cancel
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 16 }}>
          <button style={{ ...btn, backgroundColor: "var(--fg)", color: "var(--bg)", padding: "10px 18px" }} onClick={() => onSignIn()}>
            Continue with ChatGPT
          </button>
          <button
            style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 13 }}
            onClick={() => onSignIn({ newAccount: true })}
            title="Register this app with a different ChatGPT account or workspace"
          >
            Use a different ChatGPT account
          </button>
        </div>
      )}
    </div>
  );
}
