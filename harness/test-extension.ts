/**
 * Loads the built extension into a real (headless) Chrome and verifies the half
 * of the system the Bun harness can't reach:
 *
 *   1. the MV3 service worker registers,
 *   2. the new-tab override renders (the engine setup screen on a fresh profile),
 *   3. the worker answers `subscribe` on the build port with a snapshot,
 *   4. `startBuild` with no API key fails cleanly with an error message,
 *   5. `chrome.history` is readable, so the `history` permission is real,
 *   6. the theme toggle cycles system → dark → light, restyles the page and persists.
 *
 * No API calls are made. Chrome 136+ ignores `--load-extension`, so the
 * extension is loaded over CDP's Extensions domain instead.
 *
 * Run: pnpm build && pnpm extension:test
 * Set CHROME_PATH if Chrome isn't at the default macOS location.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    "renders the setup screen with the Claude engine selected",
    /Choose who writes your homepage/i.test(bodyText) && /Connect your Anthropic API key/i.test(bodyText),
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
  const authMsg = subscribed.find((m) => m.kind === "auth");
  check(
    "subscribe also reports the credential state",
    Boolean(authMsg) && authMsg.state.engine === "claude" && authMsg.state.ready === false,
    JSON.stringify(authMsg?.state),
  );

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

  // ---- 6. theme toggle ------------------------------------------------------
  const readTheme = () =>
    page.evaluate<{ attr: string | null; bg: string; toggle: string | null; stored: string | null }>(`
      (async () => ({
        attr: document.documentElement.getAttribute("data-theme"),
        bg: getComputedStyle(document.body).backgroundColor,
        toggle: document.querySelector("[data-theme-toggle]")?.getAttribute("data-theme-toggle") ?? null,
        stored: (await chrome.storage.local.get("theme")).theme ?? null,
      }))()
    `);
  const clickToggle = () =>
    page.evaluate<boolean>(`(() => { const b = document.querySelector("[data-theme-toggle]"); if (!b) return false; b.click(); return true; })()`);
  const shots = join(import.meta.dir, "out");
  mkdirSync(shots, { recursive: true });
  const shoot = async (name: string) => {
    const r = await page.send("Page.captureScreenshot", { format: "png" });
    if (r.result?.data) writeFileSync(join(shots, `theme-${name}.png`), Buffer.from(r.result.data, "base64"));
  };

  const initial = await readTheme();
  check("theme starts on system (no data-theme)", initial.toggle === "system" && initial.attr === null, JSON.stringify(initial));
  await shoot("system");
  check("toggle present", await clickToggle());
  await sleep(400);
  const dark = await readTheme();
  check(
    "one click forces dark: data-theme, stored preference and a dark background",
    dark.toggle === "dark" && dark.attr === "dark" && dark.stored === "dark" && dark.bg === "rgb(21, 23, 28)",
    JSON.stringify(dark),
  );
  await shoot("dark");
  await clickToggle();
  await sleep(400);
  const light = await readTheme();
  check(
    "second click forces light: data-theme, stored preference and a white background",
    light.toggle === "light" && light.attr === "light" && light.stored === "light" && light.bg === "rgb(255, 255, 255)",
    JSON.stringify(light),
  );
  await shoot("light");
  await clickToggle();
  await sleep(400);
  const back = await readTheme();
  check("third click returns to system", back.toggle === "system" && back.attr === null && back.stored === "system", JSON.stringify(back));

  // With a key saved and dark forced, the build screen and the settings modal
  // must pick the tokens up too (a reload applies the mirrored preference first).
  await page.evaluate("chrome.storage.local.set({ apiKey: 'sk-ant-test', theme: 'dark' })");
  await page.send("Page.reload");
  await sleep(2500);
  const buildScreen = await readTheme();
  const buildText = await page.evaluate<string>("document.body.innerText");
  check(
    "after a reload the stored dark theme applies before React renders",
    buildScreen.attr === "dark" && /Build your homepage/.test(buildText),
    JSON.stringify(buildScreen),
  );
  await shoot("dark-build");

  // A saved homepage brings the toolbar (Rebuild, Settings, theme) and the preview.
  const homepage = {
    code: "import React from 'react';\nexport default function PersonalizedHomepage() { return <h1>Hello</h1>; }",
    timestamp: new Date().toISOString(),
  };
  await page.evaluate(`chrome.storage.local.set({ homepageData: ${JSON.stringify(homepage)} })`);
  await page.send("Page.reload");
  await sleep(3000);
  const opened = await page.evaluate<boolean>(
    `(() => { const b = [...document.querySelectorAll("button")].find((b) => /Settings/.test(b.textContent)); if (!b) return false; b.click(); return true; })()`,
  );
  await sleep(400);
  const modalText = await page.evaluate<string>("document.body.innerText");
  check("settings modal opens over the homepage, themed", opened && /Customize your homepage/.test(modalText));
  await shoot("dark-settings");

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
