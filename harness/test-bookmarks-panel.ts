/**
 * Drives the built extension in headless Chrome and checks the bookmarks panel
 * end to end: real bookmarks are created, the new tab opens, the Bookmarks
 * button shows the links, and excluding a folder in Settings removes them.
 *
 * No API calls are made. A dummy API key is stored so the new tab skips the
 * key screen. Run: pnpm build && bun harness/test-bookmarks-panel.ts
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const EXT = join(import.meta.dir, "../apps/extension/.output/chrome-mv3");
const PORT = 9334;
const SHOT = join(process.env.SHOT_DIR ?? tmpdir(), "bookmarks-panel.png");

if (!existsSync(join(EXT, "manifest.json"))) {
  console.error(`No build at ${EXT}. Run: pnpm build`);
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), "hp-bm-"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label: string, pass: boolean, extra = "") => {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
  if (!pass) failures++;
};

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-unsafe-extension-debugging",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const getJson = async (path: string) => (await fetch(`http://127.0.0.1:${PORT}${path}`)).json() as Promise<any>;

async function cdp(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const waiters = new Map<number, (v: any) => void>();
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data));
    if (msg.id && waiters.has(msg.id)) {
      waiters.get(msg.id)!(msg);
      waiters.delete(msg.id);
    }
  };
  const send = (method: string, params: unknown = {}) =>
    new Promise<any>((res) => {
      const n = ++id;
      waiters.set(n, res);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  return {
    send,
    close: () => ws.close(),
    async evaluate<T>(expression: string): Promise<T> {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      const ex = r.result?.exceptionDetails;
      if (ex) throw new Error(ex.exception?.description ?? JSON.stringify(ex));
      return r.result?.result?.value as T;
    },
  };
}

try {
  let version: any;
  for (let i = 0; i < 80 && !version; i++) {
    try {
      version = await getJson("/json/version");
    } catch {
      await sleep(250);
    }
  }
  if (!version) throw new Error("Chrome devtools endpoint never came up");

  const browser = await cdp(version.webSocketDebuggerUrl);
  const loaded = await browser.send("Extensions.loadUnpacked", { path: EXT });
  const extId: string | undefined = loaded.result?.id;
  if (!extId) throw new Error(`loadUnpacked failed: ${JSON.stringify(loaded)}`);

  // Wait for the worker, then create a bookmark folder with two links through the real API.
  let sw: any;
  for (let i = 0; i < 40 && !sw; i++) {
    sw = (await getJson("/json/list")).find((t: any) => t.type === "service_worker" && t.url.includes(extId));
    if (!sw) await sleep(250);
  }
  check("service worker registered", Boolean(sw));
  const worker = await cdp(sw.webSocketDebuggerUrl);
  await worker.send("Runtime.enable");
  const folderId: string = await worker.evaluate(`(async () => {
    const bar = (await chrome.bookmarks.getTree())[0].children[0];
    const f = await chrome.bookmarks.create({ parentId: bar.id, title: "Harness Folder" });
    await chrome.bookmarks.create({ parentId: f.id, title: "Harness Alpha", url: "https://example.com/alpha" });
    await chrome.bookmarks.create({ parentId: f.id, title: "Harness Beta", url: "https://example.org/beta" });
    return f.id;
  })()`);
  worker.close();

  // Open the new tab, store a dummy key so the key screen is skipped.
  const targets: any[] = await getJson("/json/list");
  const pageTarget = targets.find((t) => t.type === "page");
  if (!pageTarget) throw new Error("no page target");
  const page = await cdp(pageTarget.webSocketDebuggerUrl);
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await page.send("Page.navigate", { url: `chrome-extension://${extId}/newtab.html` });
  await sleep(1500);
  await page.evaluate(`chrome.storage.local.set({ apiKey: "sk-test-dummy" })`);
  await page.send("Page.reload");
  await sleep(2000);

  // Open the panel.
  const clickByText = (text: string) =>
    page.evaluate(`(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes(${JSON.stringify(text)}));
      if (!b) return false; b.click(); return true;
    })()`);

  check("Bookmarks button is shown by default", Boolean(await page.evaluate(`[...document.querySelectorAll("button")].some((x) => x.textContent.includes("Bookmarks"))`)));
  check("opened the panel", Boolean(await clickByText("Bookmarks")));
  await sleep(800);

  const panelText: string = await page.evaluate(`document.querySelector("aside")?.innerText ?? ""`);
  check("panel lists Harness Alpha", panelText.includes("Harness Alpha"));
  check("panel lists Harness Beta", panelText.includes("Harness Beta"));
  check("panel shows the subfolder path", panelText.includes("Harness Folder"));

  const shot = await page.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(SHOT, Buffer.from(shot.result.data, "base64"));
  console.log(`screenshot: ${SHOT}`);

  // Hide the Harness Folder's parent (Bookmarks bar) in Settings, then the panel should show none of it.
  await clickByText("Close");
  await sleep(300);
  const barId: string = await page.evaluate(`(async () => {
    const t = await chrome.bookmarks.getTree(); return t[0].children[0].id;
  })()`);
  await page.evaluate(`chrome.storage.local.set({ bookmarkExcludedFolderIds: [${JSON.stringify(barId)}] })`);
  await page.send("Page.reload");
  await sleep(2000);
  await clickByText("Bookmarks");
  await sleep(800);
  const afterText: string = await page.evaluate(`document.querySelector("aside")?.innerText ?? ""`);
  check("excluded folder hides its links", !afterText.includes("Harness Alpha"));

  page.close();
} finally {
  chrome.kill();
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
