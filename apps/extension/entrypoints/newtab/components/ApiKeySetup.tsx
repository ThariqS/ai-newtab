import { useState } from "react";
import { btn } from "./ui";

const PROVIDERS = {
  anthropic: {
    title: "Connect your Anthropic API key",
    prefix: "sk-ant-",
    placeholder: "sk-ant-...",
    api: "the Anthropic API",
    console: "console.anthropic.com",
  },
  openai: {
    title: "Connect your OpenAI API key",
    prefix: "sk-",
    placeholder: "sk-proj-...",
    api: "the OpenAI API",
    console: "platform.openai.com",
  },
} as const;

export function ApiKeySetup({
  provider,
  onSave,
}: {
  provider: keyof typeof PROVIDERS;
  onSave: (key: string) => void;
}) {
  const [value, setValue] = useState("");
  const p = PROVIDERS[provider];
  const valid = value.trim().startsWith(p.prefix);

  return (
    <div>
      <h2 style={{ fontSize: 20, marginTop: 0 }}>{p.title}</h2>
      <p style={{ color: "#555", lineHeight: 1.6 }}>
        The agent runs inside this extension and talks to {p.api} directly. Your key is stored
        in <code>chrome.storage.local</code> on this machine and is never sent anywhere else.
        Keys come from {p.console}.
      </p>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={p.placeholder}
        style={{
          width: "100%",
          boxSizing: "border-box",
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
