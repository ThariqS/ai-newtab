import { afterEach, expect, test } from "bun:test";
import { getBookmarkFolders, getTopLevelFolderNames } from "../apps/extension/lib/bookmarks";

// A tree shaped like Chrome's: a root with the three fixed top-level folders.
const tree = [
  {
    id: "0",
    title: "",
    children: [
      {
        id: "1",
        title: "Bookmarks bar",
        children: [
          { id: "10", title: "Docs", url: "https://example.com/docs" },
          {
            id: "11",
            title: "Work",
            children: [
              { id: "12", title: "Inner", url: "https://example.org/inner" },
              { id: "13", title: "Bad", url: "javascript:alert(1)" },
            ],
          },
        ],
      },
      { id: "2", title: "Other bookmarks", children: [{ id: "20", title: "", url: "https://x.test/" }] },
      { id: "3", title: "Mobile bookmarks", children: [] },
    ],
  },
];

const g = globalThis as { browser?: unknown };
const original = g.browser;

function installTree() {
  g.browser = { bookmarks: { getTree: async () => tree } };
}

afterEach(() => {
  g.browser = original;
});

test("lists all top-level folders with their ids", async () => {
  installTree();
  const names = await getTopLevelFolderNames();
  expect(names.map((f) => f.title)).toEqual(["Bookmarks bar", "Other bookmarks", "Mobile bookmarks"]);
});

test("returns every http(s) bookmark, flattening subfolders with a path", async () => {
  installTree();
  const folders = await getBookmarkFolders([]);
  const bar = folders.find((f) => f.id === "1")!;
  expect(bar.links.map((l) => l.url)).toEqual(["https://example.com/docs", "https://example.org/inner"]);
  expect(bar.links[1].path).toBe("Work");
  expect(bar.links[0].path).toBe("");
});

test("skips javascript: and other non-http links", async () => {
  installTree();
  const folders = await getBookmarkFolders([]);
  const all = folders.flatMap((f) => f.links.map((l) => l.url));
  expect(all.some((u) => u.startsWith("javascript:"))).toBe(false);
});

test("uses the URL as the title when a bookmark has no title", async () => {
  installTree();
  const folders = await getBookmarkFolders([]);
  const other = folders.find((f) => f.id === "2")!;
  expect(other.links[0].title).toBe("https://x.test/");
});

test("excluded folder ids are left out entirely", async () => {
  installTree();
  const folders = await getBookmarkFolders(["1", "3"]);
  expect(folders.map((f) => f.id)).toEqual(["2"]);
});

test("an empty exclusion list shows everything", async () => {
  installTree();
  const folders = await getBookmarkFolders([]);
  expect(folders.length).toBe(3);
});
