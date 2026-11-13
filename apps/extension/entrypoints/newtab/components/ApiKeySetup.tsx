import { useState } from "react";
import { btn } from "./ui";

/** A cheap shape check before saving; the API is the real judge of validity. */
export const looksLikeApiKey = (value: string) => value.trim().startsWith("sk-ant-");

/** Enough of a key to tell which one is saved, without showing it. */
export const maskApiKey = (key: string) => `sk-ant-…${key.slice(-4)}`;

export function ApiKeySetup({ onSave }: { onSave: (key: string) => void }) {
  const [value, setValue] = useState("");
  const valid = looksLikeApiKey(value);

  return (
    <div style={{ maxWidth: 520, margin: "12vh auto", padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 24 }}>Connect your Anthropic API key</h1>
      <p style={{ color: "#555", lineHeight: 1.6 }}>
        The agent runs inside this extension and talks to the Anthropic API directly. Your key
        is stored in <code>chrome.storage.local</code> on this machine and is never sent
        anywhere else.
      </p>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="sk-ant-..."
        style={{
          width: "100%",
          padding: 12,
          fontSize: 14,
          borderRadius: 4,
          border: "1px solid #ddd",
          fontFamily: "ui-monospace, monospace",
        }}
      />
      <button
        style={{ ...btn, marginTop: 16, opacity: valid ? 1 : 0.5 }}
        disabled={!valid}
        onClick={() => onSave(value.trim())}
      >
        Save key
      </button>
    </div>
  );
}
