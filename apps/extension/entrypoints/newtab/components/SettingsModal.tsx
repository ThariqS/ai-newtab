import { useState } from "react";
import { MODEL_CHOICES, normalizeBlockList, type HomepageModel } from "@homepage/agent-core";
import { looksLikeApiKey, maskApiKey } from "./ApiKeySetup";
import { btn } from "./ui";

export function SettingsModal({
  initialPrompt,
  blockedSites,
  apiKey,
  model,
  onChangeModel,
  autoRebuild,
  onToggleAutoRebuild,
  onClose,
  onSave,
}: {
  initialPrompt: string;
  blockedSites: string[];
  apiKey: string;
  model: HomepageModel;
  onChangeModel: (next: HomepageModel) => void;
  autoRebuild: boolean;
  onToggleAutoRebuild: (next: boolean) => void;
  onClose: () => void;
  /** `newApiKey` is set only when the user entered a replacement key. */
  onSave: (prompt: string, blockedSites: string[], newApiKey?: string) => void;
}) {
  const [draft, setDraft] = useState(initialPrompt);
  const [blockedDraft, setBlockedDraft] = useState(blockedSites.join("\n"));
  const [keyDraft, setKeyDraft] = useState("");
  const keyEntered = keyDraft.trim() !== "";
  const keyInvalid = keyEntered && !looksLikeApiKey(keyDraft);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ backgroundColor: "white", borderRadius: 8, padding: 24, width: "90%", maxWidth: 600, maxHeight: "90vh", overflowY: "auto" }}>
        <h2 style={{ marginTop: 0, color: "#333" }}>Customize your homepage</h2>
        <p style={{ color: "#666" }}>Standing instructions applied to every build.</p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. 'Focus on tech news and Rust releases', 'Always surface unread GitHub PRs first'"
          style={{
            width: "100%",
            minHeight: 200,
            padding: 12,
            fontSize: 14,
            borderRadius: 4,
            border: "1px solid #ddd",
            fontFamily: "inherit",
          }}
        />
        <label style={{ display: "block", marginTop: 16, color: "#333", fontSize: 14 }}>
          Sites the agent never reads
          <textarea
            value={blockedDraft}
            onChange={(e) => setBlockedDraft(e.target.value)}
            aria-describedby="blocked-sites-help"
            style={{ width: "100%", boxSizing: "border-box", minHeight: 120, marginTop: 8, padding: 12, fontSize: 14, borderRadius: 4, border: "1px solid #ddd", fontFamily: "inherit" }}
          />
        </label>
        <p id="blocked-sites-help" style={{ color: "#888", fontSize: 12, margin: "6px 0 0" }}>
          One per line. Subdomains are included. Use *.example.com for wildcards.
        </p>
        <label
          style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, color: "#333", fontSize: 14 }}
        >
          Model
          <select
            value={model}
            onChange={(e) => onChangeModel(e.target.value as HomepageModel)}
            style={{ padding: "4px 8px", fontSize: 14, borderRadius: 4, border: "1px solid #ddd" }}
          >
            {MODEL_CHOICES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 16,
            color: "#333",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={autoRebuild}
            onChange={(e) => onToggleAutoRebuild(e.target.checked)}
          />
          Rebuild automatically each morning
        </label>
        <p style={{ color: "#888", fontSize: 12, margin: "6px 0 0" }}>
          When on, the extension builds one morning edition a day in the background (first time
          Chrome is open between 5am and noon), so your next tab shows a fresh one (uses your API key).
        </p>
        <label style={{ display: "block", marginTop: 16, color: "#333", fontSize: 14 }}>
          Anthropic API key{" "}
          <span style={{ color: "#888", fontFamily: "ui-monospace, monospace" }}>({maskApiKey(apiKey)})</span>
          <input
            type="password"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            placeholder="Paste a new key to replace it (sk-ant-...)"
            autoComplete="off"
            aria-describedby="api-key-help"
            style={{ width: "100%", boxSizing: "border-box", marginTop: 8, padding: 10, fontSize: 14, borderRadius: 4, border: `1px solid ${keyInvalid ? "#c0392b" : "#ddd"}`, fontFamily: "ui-monospace, monospace" }}
          />
        </label>
        <p id="api-key-help" style={{ color: keyInvalid ? "#c0392b" : "#888", fontSize: 12, margin: "6px 0 0" }}>
          {keyInvalid
            ? "That doesn't look like an Anthropic key. Keys start with sk-ant-."
            : "Leave blank to keep the current key. Stored only in this browser."}
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 20, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{ ...btn, backgroundColor: "white", color: "#333", border: "1px solid #ddd" }}
          >
            Cancel
          </button>
          <button
            onClick={() =>
              onSave(draft, normalizeBlockList(blockedDraft.split("\n")), keyEntered ? keyDraft.trim() : undefined)
            }
            disabled={keyInvalid}
            style={{ ...btn, opacity: keyInvalid ? 0.5 : 1 }}
          >
            Save &amp; rebuild
          </button>
        </div>
      </div>
    </div>
  );
}
