/**
 * Reads the user's Chrome bookmarks for the bookmarks panel on the new-tab page.
 *
 * Bookmarks never leave the browser: this module is not imported by agent-core,
 * and nothing here is passed to the model.
 */

export interface BookmarkLink {
  title: string;
  url: string;
  /** Folder path from the top-level folder down, e.g. "Work / Docs". Empty for top-level links. */
  path: string;
}

export interface BookmarkFolder {
  id: string;
  title: string;
  links: BookmarkLink[];
}

/** The subset of chrome.bookmarks tree nodes this module reads. */
interface BookmarkNode {
  id: string;
  title: string;
  url?: string;
  children?: BookmarkNode[];
}

/** The one bookmarks call this module makes. Typed here so it compiles outside the extension build too. */
interface BookmarksApi {
  getTree(): Promise<BookmarkNode[]>;
  create(node: { parentId: string; title: string; url: string }): Promise<unknown>;
}

export interface Shortcut {
  id: string;
  title: string;
  url: string;
}

function bookmarksApi(): BookmarksApi {
  return (globalThis as unknown as { browser: { bookmarks: BookmarksApi } }).browser.bookmarks;
}

/** Top-level folders Chrome always creates: Bookmarks bar, Other bookmarks, Mobile bookmarks. */
export async function getTopLevelFolderNames(): Promise<{ id: string; title: string }[]> {
  const [root] = await bookmarksApi().getTree();
  return (root?.children ?? [])
    .filter((node) => !node.url)
    .map((node) => ({ id: node.id, title: node.title || "Untitled" }));
}

/**
 * All bookmarks grouped by top-level folder. Folders listed in `excludedIds`
 * are skipped. Subfolders are flattened into their parent group with a path.
 */
export async function getBookmarkFolders(excludedIds: string[]): Promise<BookmarkFolder[]> {
  const [root] = await bookmarksApi().getTree();
  const excluded = new Set(excludedIds);
  const folders: BookmarkFolder[] = [];

  for (const top of root?.children ?? []) {
    if (top.url || excluded.has(top.id)) continue;
    const links: BookmarkLink[] = [];
    collectLinks(top.children ?? [], "", links);
    folders.push({ id: top.id, title: top.title || "Untitled", links });
  }
  return folders;
}

function collectLinks(nodes: BookmarkNode[], path: string, out: BookmarkLink[]): void {
  for (const node of nodes) {
    if (node.url) {
      if (!/^https?:/i.test(node.url)) continue; // skip javascript:, chrome:, file:
      out.push({ title: node.title || node.url, url: node.url, path });
    } else if (node.children) {
      const childPath = path ? `${path} / ${node.title}` : node.title;
      collectLinks(node.children, childPath, out);
    }
  }
}

/**
 * The first `limit` direct links of the visible top-level folders, in browser
 * order. These are the tiles on the new-tab page, so only direct children count.
 */
export async function getShortcuts(excludedIds: string[], limit: number): Promise<Shortcut[]> {
  const [root] = await bookmarksApi().getTree();
  const excluded = new Set(excludedIds);
  const out: Shortcut[] = [];
  for (const top of root?.children ?? []) {
    if (top.url || excluded.has(top.id)) continue;
    for (const node of top.children ?? []) {
      if (node.url && /^https?:/i.test(node.url)) {
        out.push({ id: node.id, title: node.title || node.url, url: node.url });
      }
    }
  }
  return out.slice(0, limit);
}

/** Saves a new shortcut as a link in the Bookmarks bar. Throws on a non-http URL. */
export async function addShortcut(title: string, url: string): Promise<void> {
  const parsed = new URL(url); // throws on malformed input
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("The address must start with http or https.");
  const [root] = await bookmarksApi().getTree();
  const bar = (root?.children ?? []).find((n) => !n.url && n.title === "Bookmarks bar") ?? root?.children?.[0];
  if (!bar) throw new Error("No Bookmarks bar was found.");
  await bookmarksApi().create({ parentId: bar.id, title: title.trim() || parsed.hostname, url: parsed.href });
}

/** Chrome's own icon cache for a page. Needs the "favicon" permission; no request leaves the browser. */
export function faviconUrl(pageUrl: string): string {
  const runtime = (globalThis as unknown as { browser: { runtime: { getURL(p: string): string } } }).browser.runtime;
  return runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=64`);
}
