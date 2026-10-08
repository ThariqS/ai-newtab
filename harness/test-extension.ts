/**
 * Loads the built extension into a real (headless) Chrome and verifies the half
 * of the system the Bun harness can't reach:
 *
 *   1. the MV3 service worker registers,
 *   2. the new-tab override renders (the API-key screen on a fresh profile),
 *   3. the worker answers `subscribe` on the build port with a snapshot,
 *   4. `startBuild` with no API key fails cleanly with an error message,
 *   5. `chrome.history` is readable, so the `history` permission is real.
 *
 * No API calls are made. Chrome 136+ ignores `--load-extension`, so the
 * extension is loaded over CDP's Extensions domain instead.
 *
 * Run: pnpm build && pnpm extension:test
 * Set CHROME_PATH if Chrome isn't at the default macOS location.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const EXT = join(import.meta.dir, "../apps/extension/.output/chrome-mv3");
const PORT = 9333;

if (!existsSync(join(EXT, "manifest.json"))) {
  console.error(`No build at ${EXT}. Run: pnpm build`);
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), "hp-ext-"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (label: string, pass: boolean, extra?: string) => {
  console.log(`${pass ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!pass) failures++;
};

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-unsafe-extension-debugging", // required for the CDP Extensions domain
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

async function getJson(path: string) {
  return (await fetch(`http://127.0.0.1:${PORT}${path}`)).json() as Promise<any>;
}

/** Minimal CDP client over a target's websocket. */
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
      const r = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      const ex = r.result?.exceptionDetails;
      if (ex) throw new Error(ex.exception?.description ?? JSON.stringify(ex));
      return r.result?.result?.value as T;
    },
  };
}

try {
  let version: any;
  for (let i = 0; i < 80; i++) {
    try {
      version = await getJson("/json/version");
      break;
    } catch {
      await sleep(250);
    }
  }
  if (!version) throw new Error("Chrome devtools endpoint never came up");
  console.log(`   ${version.Browser}\n`);

  // ---- load the unpacked extension ----------------------------------------
  const browser = await cdp(version.webSocketDebuggerUrl);
  const loaded = await browser.send("Extensions.loadUnpacked", { path: EXT });
  const extId: string | undefined = loaded.result?.id;
  if (!extId) throw new Error(`loadUnpacked failed: ${JSON.stringify(loaded)}`);
  console.log(`   extension id: ${extId}\n`);

  // ---- 1. service worker ---------------------------------------------------
  let sw: any;
  for (let i = 0; i < 40 && !sw; i++) {
    const targets: any[] = await getJson("/json/list");
    sw = targets.find((t) => t.type === "service_worker" && t.url.includes(extId));
    if (!sw) await sleep(250);
  }
  check("MV3 service worker registered", Boolean(sw), sw?.url.split("/").pop());

  // ---- 2. new-tab override renders ----------------------------------------
  const targets: any[] = await getJson("/json/list");
  const blank = targets.find((t) => t.type === "page");
  if (!blank) throw new Error("no page target to navigate");

  const page = await cdp(blank.webSocketDebuggerUrl);
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  const nav = await page.send("Page.navigate", { url: `chrome-extension://${extId}/newtab.html` });
  if (nav.result?.errorText) throw new Error(`navigate failed: ${nav.result.errorText}`);

  let href = "";
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      href = await page.evaluate<string>("location.href");
      const ready = await page.evaluate<string>("document.readyState");
      if (href.startsWith("chrome-extension://") && ready === "complete") break;
    } catch {
      /* navigation in flight */
    }
  }
  check("new-tab override loads", href.startsWith("chrome-extension://"), href);

  await sleep(2500); // let React mount
  const bodyText = await page.evaluate<string>("document.body.innerText");
  check(
    "renders the API-key setup screen",
    /Connect your Anthropic API key/i.test(bodyText),
    bodyText.split("\n").filter(Boolean)[0]?.slice(0, 50),
  );

  // Open a build port, send one message, and collect replies for a moment.
  const talk = (msg: object, waitMs: number) =>
    page.evaluate<string>(`
      new Promise((resolve) => {
        const port = chrome.runtime.connect({ name: "homepage-agent" });
        const replies = [];
        port.onMessage.addListener((m) => replies.push(m));
        port.postMessage(${JSON.stringify(msg)});
        setTimeout(() => { port.disconnect(); resolve(JSON.stringify(replies)); }, ${waitMs});
      })
    `).then((raw) => JSON.parse(raw) as any[]);

  // ---- 3. subscribe → snapshot ---------------------------------------------
  const subscribed = await talk({ kind: "subscribe" }, 1500);
  const snapshot = subscribed.find((m) => m.kind === "snapshot");
  check(
    "worker answers subscribe with a build snapshot",
    Boolean(snapshot) && snapshot.state.running === false,
    JSON.stringify(subscribed[0])?.slice(0, 80),
  );

  // ---- 4. startBuild without a key fails cleanly ----------------------------
  const started = await talk({ kind: "startBuild" }, 3000);
  const error = started.find((m) => m.kind === "error");
  check("startBuild with no API key reports an error", /API key/i.test(error?.message ?? ""), error?.message);

  // ---- 5. chrome.history is readable ---------------------------------------
  const domains = await page.evaluate<string[]>(`
    (async () => {
      const seed = [
        "https://news.ycombinator.com/",
        "https://news.ycombinator.com/item?id=1",
        "https://lobste.rs/",
        "https://arstechnica.com/",
      ];
      for (const url of seed) await chrome.history.addUrl({ url });
      await new Promise((r) => setTimeout(r, 500));
      const items = await chrome.history.search({ text: "", startTime: 0, maxResults: 100 });
      return [...new Set(items.map((i) => new URL(i.url).hostname))];
    })()
  `);
  check(
    "chrome.history is readable (seeded domains returned)",
    domains.includes("news.ycombinator.com"),
    domains.join(", "),
  );

  // A saved receipt must be readable without making an agent request.
  await page.evaluate(`chrome.storage.local.set({ apiKey: "test-only", autoRebuild: false,
    homepageData: { code: "export default function PersonalizedHomepage() { return <div>Receipt fixture</div>; }", timestamp: "2026-10-08T12:00:00Z",
      receipt: { startedAt: "2026-10-08T12:00:00Z", finishedAt: "2026-10-08T12:00:05Z", model: "claude-haiku-5-5", historyWindowDays: 7, totalSitesSeen: 12, domainsSent: ["example.com"], pagesUploaded: [{ url: "https://example.com", bytes: 42 }], pagesFailed: [{ url: "https://failed.test", reason: "timeout" }], usage: { inputTokens: 123, outputTokens: 45 } }
    } })`);
  await page.send("Page.reload");
  await sleep(2500);
  await page.evaluate(`Array.from(document.querySelectorAll("button")).find(b => b.textContent === "What this build read").click()`);
  const receiptText = await page.evaluate<string>(`document.querySelector("dialog[open]").innerText`);
  check("receipt opens at its summary", await page.evaluate<boolean>(`(() => { const d = document.querySelector("dialog[open]"); const h = d.querySelector("h2").getBoundingClientRect(); return h.top >= d.getBoundingClientRect().top; })()`));
  check("receipt shows saved domains, uploads, failures and usage", ["example.com", "42 bytes", "timeout", "claude-haiku-5-5", "Duration: 5s", "Input: 123"].every(text => receiptText.includes(text)));
  for (const width of [1280, 375]) {
    await page.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
    check(`receipt fits at ${width}px`, await page.evaluate<boolean>(`(() => { const d = document.querySelector("dialog"); const r = d.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && d.scrollWidth <= d.clientWidth; })()`));
  }
  await page.evaluate(`Array.from(document.querySelectorAll("dialog button")).find(b => b.textContent === "Close").click()`);
  check("receipt closes", await page.evaluate<boolean>(`!document.querySelector("dialog[open]")`));

  page.close();
  browser.close();
} catch (err) {
  console.error(`\n❌ ${err instanceof Error ? err.message : err}`);
  failures++;
} finally {
  chrome.kill("SIGKILL");
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}

console.log(
  `\n${failures === 0 ? "\x1b[32mEXTENSION VERIFIED\x1b[0m" : `\x1b[31m${failures} check(s) failed\x1b[0m`}`,
);
process.exit(failures === 0 ? 0 : 1);
