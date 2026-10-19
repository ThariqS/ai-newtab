/**
 * Checks shortcut tiles end to end in headless Chrome: tiles for the Bookmarks
 * bar links, the site icon (or letter fallback), the Add shortcut form saving a
 * new bookmark, refusal of a javascript: address, and the tiles on the
 * homepage view. No API calls are made.
 *
 * Run: pnpm build && bun harness/test-shortcuts.ts
 * Screenshots go to SHOT_DIR (default: the system temp dir).
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

/** The visible label of each tile: the last <span>, which excludes the icon or letter circle. */
const TILE_LABELS = `[...document.querySelectorAll("a[data-shortcut]")].map((a) => a.querySelector("span:last-child").textContent.trim())`;

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

  // Seed two bookmarks on the Bookmarks bar. GitHub and YouTube serve a real favicon.ico.
  const worker = await cdp(sw.webSocketDebuggerUrl);
  await worker.send("Runtime.enable");
  await worker.evaluate(`(async () => {
    const bar = (await chrome.bookmarks.getTree())[0].children[0];
    await chrome.bookmarks.create({ parentId: bar.id, title: "Alpha Site", url: "https://github.com/" });
    await chrome.bookmarks.create({ parentId: bar.id, title: "Beta Site", url: "https://www.youtube.com/" });
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

  const tiles: string[] = await page.evaluate(TILE_LABELS);
  check("tiles show the Bookmarks bar links", tiles.join("|") === "Alpha Site|Beta Site", tiles.join(", "));
  check("an Add shortcut tile is shown", (await page.evaluate(`document.body.innerText.includes("Add shortcut")`)) === true);

  // Add a shortcut for a site with no favicon.ico. Its tile must show the letter, and the label stays exact.
  await page.evaluate(`[...document.querySelectorAll("button")].find((b) => b.title === "Add shortcut").click()`);
  await sleep(300);
  await page.evaluate(`(() => {
    const setField = (el, v) => {
      const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      s.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    setField(document.querySelector('input[placeholder="Name"]'), "Gamma Site");
    setField(document.querySelector('input[placeholder="https://example.com"]'), "https://example.net/");
  })()`);
  await sleep(200);
  await page.evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save").click()`);
  await sleep(2000);

  const after: string[] = await page.evaluate(TILE_LABELS);
  check(
    "new shortcut appears with its exact name",
    after.join("|") === "Alpha Site|Beta Site|Gamma Site",
    after.join(", "),
  );

  // A javascript: address must be rejected by the form.
  await page.evaluate(`[...document.querySelectorAll("button")].find((b) => b.title === "Add shortcut").click()`);
  await sleep(300);
  await page.evaluate(`(() => {
    const setField = (el, v) => {
      const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      s.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    setField(document.querySelector('input[placeholder="Name"]'), "Bad");
    setField(document.querySelector('input[placeholder="https://example.com"]'), "javascript:alert(1)");
  })()`);
  await sleep(200);
  await page.evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save").click()`);
  await sleep(600);
  const errText: string = await page.evaluate(`document.body.innerText`);
  check("javascript: address is refused", errText.includes("must start with http or https"));

  // Phase 2: a built homepage exists. The shortcut strip must still show, at the bottom.
  const homeCode = `import React from 'react';
export default function PersonalizedHomepage() {
  return <div style={{ padding: 40, fontFamily: 'system-ui' }}><h1>Test homepage</h1><p>Body text.</p></div>;
}`;
  await page.evaluate(`chrome.storage.local.set({ homepageData: { code: ${JSON.stringify(homeCode)}, timestamp: new Date().toISOString() } })`);
  await page.send("Page.reload");
  await sleep(3000);

  // The homepage renders in a Sandpack iframe, so its text is not in this document.
  check("homepage view renders (preview iframe present)", (await page.evaluate(`document.querySelectorAll("iframe").length > 0`)) === true);
  const strip: { ok: boolean; bottom: number; vh: number } = await page.evaluate(`(() => {
    const a = document.querySelector("a[data-shortcut]");
    if (!a) return { ok: false, bottom: 0, vh: innerHeight };
    const r = a.getBoundingClientRect();
    return { ok: r.height > 0, bottom: r.bottom, vh: innerHeight };
  })()`);
  check("shortcut tiles show on the homepage view", strip.ok);
  check("tiles sit in the bottom strip", strip.ok && strip.bottom > strip.vh * 0.5, `bottom ${Math.round(strip.bottom)} of ${strip.vh}`);

  // GitHub's tile must show a real image, not the letter fallback.
  const icon: { src: string; w: number } = await page.evaluate(`(() => {
    const img = document.querySelector("a[data-shortcut] img");
    return img ? { src: img.src, w: img.naturalWidth } : { src: "", w: 0 };
  })()`);
  check("tile icon is the site's own favicon.ico", icon.src.endsWith("/favicon.ico") && icon.w > 16, `${icon.src} natural width ${icon.w}`);

  const shot = await page.send("Page.captureScreenshot", { format: "png" });
  const shotPath = join(OUT, "shortcuts-homepage.png");
  writeFileSync(shotPath, Buffer.from(shot.result.data, "base64"));
  console.log(`screenshot: ${shotPath}`);

  page.close();
} finally {
  chrome.kill();
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
