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

const SKIN_IDS = ["metropolitan", "ledger", "capital", "nationwide", "boreal"];

/** A small homepage that follows the component contract: tokens on :root, data-part everywhere. */
const SAMPLE_HOMEPAGE = `import React from "react";
export default function PersonalizedHomepage() {
  const item = (h, s, src) => (
    <article data-part="item" style={{ padding: "10px 0", borderBottom: "var(--rule-width) solid var(--rule)" }}>
      <h3 data-part="headline" style={{ margin: 0, fontFamily: "var(--font-headline)", fontWeight: "var(--headline-weight)", fontSize: 20, lineHeight: 1.1 }}><a href="https://example.org/" style={{ color: "inherit", textDecoration: "none" }}>{h}</a></h3>
      <p data-part="summary" style={{ margin: "4px 0", fontFamily: "var(--font-body)", fontSize: 14, lineHeight: 1.45, color: "var(--ink)" }}>{s}</p>
      <div data-part="source" style={{ fontFamily: "var(--font-label)", fontSize: 10, letterSpacing: "var(--label-spacing)", textTransform: "uppercase", color: "var(--ink-muted)" }}>{src}</div>
    </article>
  );
  const section = (label, items) => (
    <section data-part="section" style={{ padding: "0 14px", borderLeft: "var(--rule-width) solid var(--rule)" }}>
      <div data-part="section-label" style={{ fontFamily: "var(--font-label)", fontSize: 11, letterSpacing: "var(--label-spacing)", textTransform: "uppercase", borderBottom: "2px solid var(--accent)", paddingBottom: 4, marginBottom: 8 }}>{label}</div>
      {items}
    </section>
  );
  return (
    <div data-part="page" style={{ background: "var(--paper)", color: "var(--ink)", fontFamily: "var(--font-body)", minHeight: "100vh", padding: "24px 32px" }}>
      <style>{\`
        :root { --paper:#f8f6f1; --ink:#1a1a1a; --ink-muted:#5a5a5a; --rule:#c9c4b8; --accent:#8b1a1a;
          --font-masthead:"Didot","Bodoni 72",Georgia,serif; --font-headline:"Times New Roman",Times,serif; --font-body:Georgia,serif; --font-label:"Helvetica Neue",Arial,sans-serif;
          --masthead-weight:700; --masthead-transform:none; --masthead-spacing:-0.02em; --headline-weight:700; --headline-spacing:-0.01em; --label-spacing:0.12em; --rule-width:1px; }
        @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --paper:#1c1a17; --ink:#ebe6dc; --ink-muted:#a9a196; --rule:#3a3631; --accent:#ff8c7a; } }
        :root[data-theme="dark"] { --paper:#1c1a17; --ink:#ebe6dc; --ink-muted:#a9a196; --rule:#3a3631; --accent:#ff8c7a; }
        a:hover { color: var(--accent); }
      \`}</style>
      <header style={{ textAlign: "center", borderBottom: "3px double var(--ink)", paddingBottom: 8 }}>
        <h1 data-part="masthead" style={{ margin: 0, fontFamily: "var(--font-masthead)", fontWeight: "var(--masthead-weight)", textTransform: "var(--masthead-transform)", letterSpacing: "var(--masthead-spacing)", fontSize: 64, lineHeight: 1 }}>The Sample Gazette</h1>
        <div data-part="tagline" style={{ fontStyle: "italic", color: "var(--ink-muted)", marginTop: 4 }}>Everything a reader followed, before the day starts.</div>
      </header>
      <div data-part="dateline" style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-label)", fontSize: 11, letterSpacing: "var(--label-spacing)", textTransform: "uppercase", padding: "6px 0", borderBottom: "var(--rule-width) solid var(--rule)", marginBottom: 18 }}><span>Monday, October 13, 2026</span><span>Morning edition</span><span>Local AI · GPU · Infrastructure</span></div>
      <section data-part="lead" style={{ marginBottom: 20 }}>
        <div data-part="kicker" style={{ fontFamily: "var(--font-label)", fontSize: 11, letterSpacing: "var(--label-spacing)", textTransform: "uppercase", color: "var(--accent)" }}>Front page · Releases</div>
        <h2 data-part="headline" style={{ margin: "6px 0", fontFamily: "var(--font-headline)", fontWeight: "var(--headline-weight)", letterSpacing: "var(--headline-spacing)", fontSize: 44, lineHeight: 1.05 }}><a href="https://example.org/lead" style={{ color: "inherit", textDecoration: "none" }}>An inference engine ships a targeted gain for mixture-of-experts models</a></h2>
        <p data-part="deck" style={{ fontStyle: "italic", fontSize: 19, margin: "6px 0", color: "var(--ink-muted)" }}>The new release speeds up one layer on a desktop GPU; the project is careful to say it is a layer benchmark, not an end-to-end one.</p>
        <p data-part="body" style={{ fontFamily: "var(--font-body)", fontSize: 16, lineHeight: 1.5, maxWidth: 720 }}>Release notes published this week describe two quantized paths that share one copy of the weights. The headline figure measures a single layer at one token, which the maintainers flag themselves.</p>
      </section>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 0.8fr", gap: 0, borderTop: "var(--rule-width) solid var(--rule)", paddingTop: 12 }}>
        {section("Local models & inference", [item("A 27-billion-parameter family claims first place on two leaderboards", "Results are self-reported; independent runs are pending. The small variant fits on a laptop.", "r/localllama · 9 h"), item("Speculative decoding slows an entry-level card", "A user measures half the throughput with the feature on despite a 95% acceptance rate.", "r/localllama · 4 h")])}
        {section("Hardware", [item("A 24 GB card rumour points at early next year", "Partners were still waiting for details; no official announcement in the thread.", "r/hardware · 1 h"), item("Driver feedback thread reaches 343 comments", "A pinned megathread collects reported issues before the update.", "r/hardware · pinned")])}
        {section("The lab", [item("A self-hosting platform fixes failed first boots", "The base image is pinned to a stable version to remove a startup incompatibility.", "GitHub · release notes"), item("A network controller update adds live feeds and a new link type", "A 9-minute walkthrough covers what changed and what to check first.", "YouTube · this morning")])}
        <section data-part="briefs" style={{ padding: "0 14px", borderLeft: "var(--rule-width) solid var(--rule)" }}>
          <div data-part="section-label" style={{ fontFamily: "var(--font-label)", fontSize: 11, letterSpacing: "var(--label-spacing)", textTransform: "uppercase", borderBottom: "2px solid var(--accent)", paddingBottom: 4, marginBottom: 8 }}>In brief</div>
          {item("A storage community compares Docker search filters", "", "r/storage")}
          {item("A native port runs at 240 fps on a laptop chip", "", "r/gaming")}
          <div data-part="coming-up" style={{ marginTop: 12, padding: 10, border: "var(--rule-width) solid var(--rule)", fontSize: 13 }}><b>Coming up</b> — a trade show keynote on Thursday; a maintenance window Saturday night.</div>
        </section>
      </div>
    </div>
  );
}`;

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
    new Promise<any>((res, rej) => {
      const n = ++id;
      const timer = setTimeout(() => {
        waiters.delete(n);
        rej(new Error(`CDP ${method} timed out after 20s`));
      }, 20_000);
      waiters.set(n, (v) => {
        clearTimeout(timer);
        res(v);
      });
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
  // This one follows the component contract (tokens + data-part), so looks apply to it.
  const homepage = { code: SAMPLE_HOMEPAGE, timestamp: new Date().toISOString() };
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
  const lookOptions = await page.evaluate<number>(
    `(() => { const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "metropolitan")); return sel ? sel.options.length : 0; })()`,
  );
  check("the Look picker lists the agent's look plus every skin", lookOptions === 1 + SKIN_IDS.length, String(lookOptions));

  // ---- 7. looks: pick each one in Settings (the live path), screenshot the page ----
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.evaluate(`document.querySelector("[data-theme-toggle]")`); // settle
  // Force light so the looks are compared on their light palettes.
  await page.evaluate(`(async () => { while (document.querySelector("[data-theme-toggle]")?.getAttribute("data-theme-toggle") !== "light") { document.querySelector("[data-theme-toggle]").click(); await new Promise((r) => setTimeout(r, 150)); } })()`);
  const pickLook = (value: string) =>
    page.evaluate<boolean>(`(() => {
      const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "metropolitan"));
      if (!sel) return false;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, ${JSON.stringify(value)});
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
  const closeSettings = () =>
    page.evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Cancel")?.click()`);
  const openSettings = () =>
    page.evaluate(`[...document.querySelectorAll("button")].find((b) => /Settings/.test(b.textContent))?.click()`);
  let picked = true;
  for (const skin of ["", ...SKIN_IDS]) {
    picked = (await pickLook(skin)) && picked;
    await sleep(200);
    await closeSettings();
    await sleep(900);
    await shoot(`look-${skin || "agent"}`);
    await openSettings();
    await sleep(300);
  }
  const storedSkin = await page.evaluate<string | null>(`chrome.storage.local.get("skin").then((r) => r.skin ?? null)`);
  check("every look can be picked and the choice is stored", picked && storedSkin === "boreal", String(storedSkin));

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
