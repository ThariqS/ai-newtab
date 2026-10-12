import type { AuthState } from "@/lib/protocol";
import { btn, errorBox } from "./ui";

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
  return (
    <div>
      <h2 style={{ fontSize: 20, marginTop: 0 }}>Allow ChatGPT plan usage</h2>
      <p style={{ color: "#555", lineHeight: 1.6 }}>
        You are signed in{auth.email ? ` as ${auth.email}` : ""}, but this app was not allowed to use your
        ChatGPT plan for requests. Building a homepage needs that permission.
      </p>
      {auth.error && (
        <div style={{ ...errorBox, margin: "16px 0", padding: 12, borderRadius: 4 }}>{auth.error}</div>
      )}
      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <button style={{ ...btn, backgroundColor: "#000" }} onClick={onEnable} disabled={auth.pending}>
          {auth.pending ? "Waiting for ChatGPT…" : "Enable ChatGPT plan usage"}
        </button>
        <button style={{ ...btn, backgroundColor: "white", color: "#333", border: "1px solid #ddd" }} onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
