import { useEffect, useState } from "react";
import { MODEL_CHOICES, normalizeBlockList, type HomepageModel } from "@homepage/agent-core";
import { REBUILD_INTERVAL_CHOICES } from "@/lib/auto-rebuild";
import { getTopLevelFolderNames } from "@/lib/bookmarks";
import { btn } from "./ui";

export function SettingsModal({
  initialPrompt,
  blockedSites,
  model,
  onChangeModel,
  autoRebuild,
  onToggleAutoRebuild,
  intervalHours,
  onChangeInterval,
  bookmarksEnabled,
  onToggleBookmarks,
  excludedFolderIds,
  onChangeExcludedFolders,
  onClose,
  onSave,
}: {
  initialPrompt: string;
  blockedSites: string[];
  model: HomepageModel;
  onChangeModel: (next: HomepageModel) => void;
  autoRebuild: boolean;
  onToggleAutoRebuild: (next: boolean) => void;
  intervalHours: number;
  onChangeInterval: (next: number) => void;
  bookmarksEnabled: boolean;
  onToggleBookmarks: (next: boolean) => void;
  excludedFolderIds: string[];
  onChangeExcludedFolders: (next: string[]) => void;
  onClose: () => void;
  onSave: (prompt: string, blockedSites: string[]) => void;
}) {
  const [draft, setDraft] = useState(initialPrompt);
  const [blockedDraft, setBlockedDraft] = useState(blockedSites.join("\n"));
  const [folders, setFolders] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    getTopLevelFolderNames().then(setFolders).catch(() => setFolders([]));
  }, []);

  function toggleFolder(id: string, shown: boolean) {
    const next = shown
      ? excludedFolderIds.filter((x) => x !== id)
      : [...excludedFolderIds, id];
    onChangeExcludedFolders(next);
  }

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
          Rebuild automatically
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 10,
            marginLeft: 24,
            color: autoRebuild ? "#333" : "#aaa",
            fontSize: 14,
          }}
        >
          Every
          <select
            value={intervalHours}
            disabled={!autoRebuild}
            onChange={(e) => onChangeInterval(Number(e.target.value))}
            style={{ padding: "4px 8px", fontSize: 14, borderRadius: 4, border: "1px solid #ddd" }}
          >
            {REBUILD_INTERVAL_CHOICES.map((h) => (
              <option key={h} value={h}>
                {h === 24 ? "24 hours (daily)" : `${h} hours`}
              </option>
            ))}
          </select>
        </label>
        <p style={{ color: "#888", fontSize: 12, margin: "6px 0 0" }}>
          When on, the extension rebuilds in the background once your homepage is this old, so
          your next tab shows a fresh one (uses your API key).
        </p>

        <h3 style={{ color: "#333", fontSize: 15, margin: "22px 0 4px" }}>Bookmarks</h3>
        <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#333", fontSize: 14, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={bookmarksEnabled}
            onChange={(e) => onToggleBookmarks(e.target.checked)}
          />
          Show the bookmarks button
        </label>
        <div style={{ marginTop: 8, marginLeft: 24, color: bookmarksEnabled ? "#333" : "#aaa", fontSize: 14 }}>
          {folders.length === 0 && <div style={{ color: "#888" }}>No bookmark folders found.</div>}
          {folders.map((f) => (
            <label key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0", cursor: "pointer" }}>
              <input
                type="checkbox"
                disabled={!bookmarksEnabled}
                checked={!excludedFolderIds.includes(f.id)}
                onChange={(e) => toggleFolder(f.id, e.target.checked)}
              />
              {f.title}
            </label>
          ))}
        </div>
        <p style={{ color: "#888", fontSize: 12, margin: "6px 0 0" }}>
          Bookmarks are read in your browser and shown only on this page. They are never sent to
          the agent.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 20, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{ ...btn, backgroundColor: "white", color: "#333", border: "1px solid #ddd" }}
          >
            Cancel
          </button>
          <button onClick={() => onSave(draft, normalizeBlockList(blockedDraft.split("\n")))} style={btn}>
            Save &amp; rebuild
          </button>
        </div>
      </div>
    </div>
  );
}
