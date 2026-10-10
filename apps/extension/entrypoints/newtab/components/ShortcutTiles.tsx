import { useEffect, useState, type CSSProperties } from "react";
import { addShortcut, getShortcuts, type Shortcut } from "@/lib/bookmarks";
import { btn } from "./ui";

const MAX_TILES = 8;

/**
 * Icon sources for a tile. Only the site's own /favicon.ico is used. When it
 * is missing, the tile shows the first letter instead. Chrome's cache is not
 * used here: for sites it does not know, it returns a generic globe.
 */
function iconSources(pageUrl: string): string[] {
  return [new URL("/favicon.ico", pageUrl).href];
}

/**
 * Row of shortcut tiles, one per bookmark, with the site icon. The last tile
 * adds a new bookmark to the Bookmarks bar. With `floating`, the row sits as a
 * strip at the bottom of the screen, over the generated homepage.
 */
export function ShortcutTiles({
  excludedFolderIds,
  floating = false,
}: {
  excludedFolderIds: string[];
  floating?: boolean;
}) {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [version, setVersion] = useState(0);
  const [adding, setAdding] = useState(false);
  const excludedKey = excludedFolderIds.join(",");

  useEffect(() => {
    getShortcuts(excludedFolderIds, MAX_TILES)
      .then(setShortcuts)
      .catch(() => setShortcuts([]));
    // Re-read when the exclusions change or a shortcut is added.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excludedKey, version]);

  return (
    <div style={floating ? floatingBox : { marginTop: 32 }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 20 }}>
        {shortcuts.map((s) => (
          <Tile key={s.id} shortcut={s} />
        ))}
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          style={{ ...tileBase, background: "none", border: "none", cursor: "pointer" }}
          title="Add shortcut"
        >
          <span style={iconCircle}>+</span>
          <span style={labelStyle}>Add shortcut</span>
        </button>
      </div>

      {adding && (
        <AddForm
          onDone={() => {
            setAdding(false);
            setVersion((v) => v + 1);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
    </div>
  );
}

function Tile({ shortcut }: { shortcut: Shortcut }) {
  const sources = iconSources(shortcut.url);
  const [stage, setStage] = useState(0);
  const letter = (shortcut.title || shortcut.url).trim().charAt(0).toUpperCase() || "?";

  return (
    <a href={shortcut.url} title={shortcut.url} data-shortcut="" style={tileBase}>
      <span style={iconCircle}>
        {stage >= sources.length ? (
          letter
        ) : (
          <img
            src={sources[stage]}
            width={28}
            height={28}
            alt=""
            onError={() => setStage((s) => s + 1)}
            style={{ borderRadius: 4 }}
          />
        )}
      </span>
      <span style={labelStyle}>{shortcut.title}</span>
    </a>
  );
}

function AddForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    try {
      await addShortcut(title, url.trim());
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div
      style={{
        maxWidth: 360,
        margin: "20px auto 0",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        fontFamily: "system-ui",
      }}
    >
      <input
        placeholder="Name"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={inputStyle}
      />
      <input
        placeholder="https://example.com"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        style={inputStyle}
      />
      {error && <div style={{ color: "#a02620", fontSize: 13 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onCancel}
          style={{ ...btn, backgroundColor: "white", color: "#333", border: "1px solid #ddd" }}
        >
          Cancel
        </button>
        <button type="button" onClick={save} style={btn}>
          Save
        </button>
      </div>
    </div>
  );
}

const floatingBox: CSSProperties = {
  position: "fixed",
  bottom: 16,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 998,
  maxWidth: "94vw",
  boxSizing: "border-box",
  padding: "12px 18px",
  borderRadius: 16,
  background: "rgba(255, 255, 255, 0.94)",
  boxShadow: "0 6px 24px rgba(0, 0, 0, 0.18)",
};

const tileBase: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 8,
  width: 96,
  textDecoration: "none",
  color: "#222",
  fontFamily: "system-ui",
};

const iconCircle: CSSProperties = {
  width: 56,
  height: 56,
  borderRadius: "50%",
  background: "#3c3c3c",
  color: "white",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 22,
  boxSizing: "border-box",
};

const labelStyle: CSSProperties = {
  fontSize: 13,
  maxWidth: 96,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const inputStyle: CSSProperties = {
  padding: "8px 10px",
  fontSize: 14,
  borderRadius: 4,
  border: "1px solid #ddd",
};
