import { useEffect, useState } from "react";
import { type BookmarkFolder, getBookmarkFolders } from "@/lib/bookmarks";
import { btn } from "./ui";

/**
 * A left-side drawer listing the bookmarks in the folders the user has not
 * excluded in Settings. It reads the browser's bookmarks on open, so it always
 * shows the current set.
 */
export function BookmarksPanel({
  excludedFolderIds,
  onClose,
}: {
  excludedFolderIds: string[];
  onClose: () => void;
}) {
  const [folders, setFolders] = useState<BookmarkFolder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBookmarkFolders(excludedFolderIds)
      .then(setFolders)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    // Read once per open; the panel is remounted each time it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = folders?.reduce((n, f) => n + f.links.length, 0) ?? 0;

  return (
    <aside
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        bottom: 0,
        width: 340,
        maxWidth: "90vw",
        zIndex: 1001,
        background: "white",
        color: "#222",
        boxShadow: "4px 0 16px rgba(0,0,0,0.2)",
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 16px",
          borderBottom: "1px solid #eee",
        }}
      >
        <strong style={{ fontSize: 16 }}>
          Bookmarks{folders ? ` (${total})` : ""}
        </strong>
        <button
          onClick={onClose}
          style={{ ...btn, padding: "4px 10px", backgroundColor: "white", color: "#333", border: "1px solid #ddd" }}
        >
          Close
        </button>
      </div>

      <div style={{ overflowY: "auto", padding: "8px 16px 24px" }}>
        {error && <p style={{ color: "#a02620", fontSize: 14 }}>Could not read bookmarks: {error}</p>}
        {!error && !folders && <p style={{ color: "#888", fontSize: 14 }}>Loading…</p>}
        {folders?.length === 0 && (
          <p style={{ color: "#888", fontSize: 14 }}>
            No bookmark folders are shown. Choose folders in Settings, under Bookmarks.
          </p>
        )}
        {folders?.map((folder) => (
          <section key={folder.id} style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: 13, textTransform: "uppercase", color: "#666", margin: "0 0 6px" }}>
              {folder.title} ({folder.links.length})
            </h3>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {folder.links.map((link, i) => (
                <li key={`${link.url}-${i}`} style={{ padding: "5px 0", fontSize: 14, lineHeight: 1.35 }}>
                  <a href={link.url} target="_blank" rel="noopener noreferrer" style={{ color: "#0066cc" }}>
                    {link.title}
                  </a>
                  {link.path && <div style={{ color: "#999", fontSize: 12 }}>{link.path}</div>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}
