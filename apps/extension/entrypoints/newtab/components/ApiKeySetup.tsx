import { useState } from "react";
import { useI18n } from "../i18n";
import { btn, input } from "./ui";

const PROVIDERS = {
  anthropic: {
    title: "apiKey.anthropic.title",
    body: "apiKey.anthropic.body",
    prefix: "sk-ant-",
    placeholder: "sk-ant-...",
  },
  openai: {
    title: "apiKey.openai.title",
    body: "apiKey.openai.body",
    prefix: "sk-",
    placeholder: "sk-proj-...",
  },
} as const;

export function ApiKeySetup({
  provider,
  onSave,
}: {
  provider: keyof typeof PROVIDERS;
  onSave: (key: string) => void;
}) {
  const { t, rich } = useI18n();
  const [value, setValue] = useState("");
  const p = PROVIDERS[provider];
  const valid = value.trim().startsWith(p.prefix);

  return (
    <div>
      <h2 style={{ fontSize: 20, marginTop: 0 }}>{t(p.title)}</h2>
      <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>{rich(p.body, { code: (text) => <code>{text}</code> })}</p>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={p.placeholder}
        style={{ ...input, fontFamily: "ui-monospace, monospace" }}
      />
      <button
        style={{ ...btn, marginTop: 16, opacity: valid ? 1 : 0.5 }}
        disabled={!valid}
        onClick={() => onSave(value.trim())}
      >
        {t("apiKey.save")}
      </button>
    </div>
  );
}
