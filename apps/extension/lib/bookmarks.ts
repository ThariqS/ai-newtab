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
