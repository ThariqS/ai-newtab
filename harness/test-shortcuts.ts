/**
 * Checks the default new-tab view end to end in headless Chrome: shortcut tiles
 * for bookmarks on the Bookmarks bar, a site icon per tile, and the Add shortcut
 * form saving a new bookmark. No API calls are made.
 *
 * Run: pnpm build && bun harness/test-shortcuts.ts
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const EXT = join(import.meta.dir, "../apps/extension/.output/chrome-mv3");
const PORT = 9335;
const OUT = process.env.SHOT_DIR ?? tmpdir();

if (!existsSync(join(EXT, "manifest.json"))) {
  console.error(`No build at ${EXT}. Run: pnpm build`);
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), "hp-sc-"));
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

  let sw: any;
  for (let i = 0; i < 40 && !sw; i++) {
    sw = (await getJson("/json/list")).find((t: any) => t.type === "service_worker" && t.url.includes(extId));
    if (!sw) await sleep(250);
  }
  check("service worker registered", Boolean(sw));

  // Seed two bookmarks on the Bookmarks bar.
  const worker = await cdp(sw.webSocketDebuggerUrl);
  await worker.send("Runtime.enable");
  await worker.evaluate(`(async () => {
    const bar = (await chrome.bookmarks.getTree())[0].children[0];
    await chrome.bookmarks.create({ parentId: bar.id, title: "Alpha Site", url: "https://example.com/" });
    await chrome.bookmarks.create({ parentId: bar.id, title: "Beta Site", url: "https://example.org/" });
    return true;
  })()`);
  worker.close();

  // Open the new tab with no homepage built, so the default view shows.
  const pageTarget = (await getJson("/json/list")).find((t: any) => t.type === "page");
  if (!pageTarget) throw new Error("no page target");
  const page = await cdp(pageTarget.webSocketDebuggerUrl);
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await page.send("Page.navigate", { url: `chrome-extension://${extId}/newtab.html` });
  await sleep(1500);
  await page.evaluate(`chrome.storage.local.set({ apiKey: "sk-test-dummy" })`);
  await page.send("Page.reload");
  await sleep(2500);

  const tiles: string[] = await page.evaluate(
    `[...document.querySelectorAll("a[data-shortcut]")].map((a) => a.textContent.trim())`,
  );
  check("tiles show the Bookmarks bar links", tiles.includes("Alpha Site") && tiles.includes("Beta Site"), tiles.join(", "));
  check("an Add shortcut tile is shown", (await page.evaluate(`document.body.innerText.includes("Add shortcut")`)) === true);

  const iconOk: boolean = await page.evaluate(`(() => {
    const imgs = [...document.querySelectorAll("a[data-shortcut] img")];
    return imgs.length > 0;
  })()`);
  check("tiles render an icon image", iconOk);

  // Add a shortcut through the form.
  await page.evaluate(`[...document.querySelectorAll("button")].find((b) => b.title === "Add shortcut").click()`);
  await sleep(300);
  await page.evaluate(`(() => {
    const set = (el, v) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; s.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
    set(document.querySelector('input[placeholder="Name"]'), "Gamma Site");
    set(document.querySelector('input[placeholder="https://example.com"]'), "https://example.net/");
  })()`);
  await sleep(200);
  await page.evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save").click()`);
  await sleep(1200);

  const after: string[] = await page.evaluate(
    `[...document.querySelectorAll("a[data-shortcut]")].map((a) => a.textContent.trim())`,
  );
  check("new shortcut appears after saving", after.includes("Gamma Site"), after.join(", "));

  // A javascript: address must be rejected by the form.
  await page.evaluate(`[...document.querySelectorAll("button")].find((b) => b.title === "Add shortcut").click()`);
  await sleep(300);
  await page.evaluate(`(() => {
    const set = (el, v) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; s.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
    set(document.querySelector('input[placeholder="Name"]'), "Bad");
    set(document.querySelector('input[placeholder="https://example.com"]'), "javascript:alert(1)");
  })()`);
  await sleep(200);
  await page.evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save").click()`);
  await sleep(600);
  const errText: string = await page.evaluate(`document.body.innerText`);
  check("javascript: address is refused", errText.includes("must start with http or https"));

  const shot = await page.send("Page.captureScreenshot", { format: "png" });
  const shotPath = join(OUT, "shortcuts-default.png");
  writeFileSync(shotPath, Buffer.from(shot.result.data, "base64"));
  console.log(`screenshot: ${shotPath}`);

  page.close();
} finally {
  chrome.kill();
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
