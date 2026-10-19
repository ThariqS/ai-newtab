/**
 * The Firefox counterpart of test-extension.ts. Loads the built extension into a
 * real (headless) Firefox and verifies:
 *
 *   1. it installs as a temporary add-on,
 *   2. a new tab opens on the extension's page, so the new-tab override is live,
 *      and renders the API-key screen on a fresh profile,
 *   3. the background page answers `subscribe` on the build port with a snapshot,
 *   4. `startBuild` with no API key fails cleanly with an error message,
 *   5. `browser.history` is readable,
 *   6. the scraper content script hands back a page's title and HTML through
 *      `scripting.executeScript` (it returns a promise, which the browser awaits).
 *
 * No API calls are made; the page in check 6 is served locally. Firefox speaks
 * WebDriver BiDi rather than CDP, and extension pages are privileged, so it is
 * started with --remote-allow-system-access.
 *
 * Run: pnpm build:firefox && pnpm extension:test:firefox
 * Set FIREFOX_PATH if Firefox isn't at the default macOS location.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FIREFOX = process.env.FIREFOX_PATH ?? "/Applications/Firefox.app/Contents/MacOS/firefox";
const EXT = join(import.meta.dir, "../apps/extension/.output/firefox-mv2");
const PORT = 9334;

if (!existsSync(join(EXT, "manifest.json"))) {
  console.error(`No build at ${EXT}. Run: pnpm build:firefox`);
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), "hp-ext-ff-"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (label: string, pass: boolean, extra?: string) => {
  console.log(`${pass ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!pass) failures++;
};

const firefox = spawn(
  FIREFOX,
  [
    "--headless",
    "--no-remote",
    "--remote-allow-system-access", // BiDi refuses moz-extension:// pages without it
    `--remote-debugging-port=${PORT}`,
    "--profile",
    profile,
    "about:blank",
  ],
  { stdio: "ignore" },
);

// A page for the scraper to read, so check 6 needs no network.
const fixture = Bun.serve({
  port: 0,
  fetch: () =>
    new Response(
      `<!doctype html><title>Fixture front page</title>
       <h1>Today's lead story</h1><p>Read <a href="https://example.com/story">the story</a>.</p>`,
      { headers: { "content-type": "text/html" } },
    ),
});

/** Minimal WebDriver BiDi client. */
async function bidi(url: string) {
  const ws = new WebSocket(url);
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
      waiters.set(n, (msg) => (msg.type === "error" ? rej(new Error(`${method}: ${msg.message}`)) : res(msg.result)));
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  return {
    send,
    close: () => ws.close(),
    /** Evaluate in a browsing context; the value round-trips as JSON. */
    async evaluate<T>(context: string, expression: string): Promise<T> {
      const r = await send("script.evaluate", {
        expression: `(async () => JSON.stringify(await (${expression})))()`,
        target: { context },
        awaitPromise: true,
        resultOwnership: "none",
      });
      if (r.type === "exception") throw new Error(r.exceptionDetails.text);
      return r.result.value === undefined ? (undefined as T) : (JSON.parse(r.result.value) as T);
    },
  };
}

let session: Awaited<ReturnType<typeof bidi>> | undefined;
try {
  for (let i = 0; i < 80 && !session; i++) {
    try {
      session = await bidi(`ws://127.0.0.1:${PORT}/session`);
    } catch {
      await sleep(250);
    }
  }
  if (!session) throw new Error("Firefox's WebDriver BiDi endpoint never came up");
  const { capabilities } = await session.send("session.new", { capabilities: {} });
  console.log(`   Firefox ${capabilities.browserVersion}\n`);

  // ---- 1. install ----------------------------------------------------------
  const installed = await session.send("webExtension.install", {
    extensionData: { type: "path", path: EXT },
  });
  check("installs as a temporary add-on", Boolean(installed.extension), installed.extension);

  // ---- 2. a new tab opens on the extension's page --------------------------
  // Open it the way the user does, from the browser window itself.
  const { contexts: chromeWindows } = await session.send("browsingContext.getTree", {
    "moz:scope": "chrome",
  });
  await session.evaluate(chromeWindows[0].context, "BrowserCommands.openTab()");

  let page: { context: string; url: string } | undefined;
  for (let i = 0; i < 40 && !page; i++) {
    await sleep(250);
    const { contexts } = await session.send("browsingContext.getTree", {});
    page = contexts.find((c: any) => /^moz-extension:\/\/[^/]+\/newtab\.html$/.test(c.url));
  }
  check("a new tab opens on the extension's page", Boolean(page), page?.url);
  if (!page) throw new Error("no new-tab page to test against");
  const tab = page.context;

  await sleep(2500); // let React mount
  const bodyText = await session.evaluate<string>(tab, "document.body.innerText");
  check(
    "renders the API-key setup screen",
    /Connect your Anthropic API key/i.test(bodyText),
    bodyText.split("\n").filter(Boolean)[0]?.slice(0, 50),
  );

  // Open a build port, send one message, and collect replies for a moment.
  const talk = (msg: object, waitMs: number) =>
    session!.evaluate<any[]>(
      tab,
      `new Promise((resolve) => {
        const port = browser.runtime.connect({ name: "homepage-agent" });
        const replies = [];
        port.onMessage.addListener((m) => replies.push(m));
        port.postMessage(${JSON.stringify(msg)});
        setTimeout(() => { port.disconnect(); resolve(replies); }, ${waitMs});
      })`,
    );

  // ---- 3. subscribe → snapshot ---------------------------------------------
  const subscribed = await talk({ kind: "subscribe" }, 1500);
  const snapshot = subscribed.find((m) => m.kind === "snapshot");
  check(
    "background answers subscribe with a build snapshot",
    Boolean(snapshot) && snapshot.state.running === false,
    JSON.stringify(subscribed[0])?.slice(0, 80),
  );

  // ---- 4. startBuild without a key fails cleanly ----------------------------
  const started = await talk({ kind: "startBuild" }, 3000);
  const error = started.find((m) => m.kind === "error");
  check("startBuild with no API key reports an error", /API key/i.test(error?.message ?? ""), error?.message);

  // ---- 5. browser.history is readable --------------------------------------
  const domains = await session.evaluate<string[]>(
    tab,
    `(async () => {
      const seed = [
        "https://news.ycombinator.com/",
        "https://news.ycombinator.com/item?id=1",
        "https://lobste.rs/",
        "https://arstechnica.com/",
      ];
      for (const url of seed) await browser.history.addUrl({ url });
      await new Promise((r) => setTimeout(r, 500));
      const items = await browser.history.search({ text: "", startTime: 0, maxResults: 100 });
      return [...new Set(items.map((i) => new URL(i.url).hostname))];
    })()`,
  );
  check(
    "browser.history is readable (seeded domains returned)",
    domains.includes("news.ycombinator.com"),
    domains.join(", "),
  );

  // ---- 6. the scraper returns page content ---------------------------------
  const scraped = await session.evaluate<{ title: string; html: string } | null>(
    tab,
    `(async () => {
      const tab = await browser.tabs.create({ url: "http://127.0.0.1:${fixture.port}/", active: false });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("fixture page never loaded")), 10000);
        browser.tabs.onUpdated.addListener(function done(id, info) {
          if (id !== tab.id || info.status !== "complete") return;
          browser.tabs.onUpdated.removeListener(done);
          clearTimeout(timer);
          resolve();
        });
      });
      try {
        const [injection] = await browser.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["/content-scripts/scraper.js"],
        });
        return injection?.result ?? null;
      } finally {
        await browser.tabs.remove(tab.id);
      }
    })()`,
  );
  check(
    "scraper content script returns the page's title and HTML",
    scraped?.title === "Fixture front page" && /lead story/.test(scraped.html),
    scraped ? `${scraped.title} (${scraped.html.length} chars)` : "no result",
  );
} catch (err) {
  console.error(`\n❌ ${err instanceof Error ? err.message : err}`);
  failures++;
} finally {
  await session?.send("browser.close").catch(() => {});
  session?.close();
  fixture.stop(true);
  firefox.kill("SIGKILL");
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}

console.log(
  `\n${failures === 0 ? "\x1b[32mEXTENSION VERIFIED\x1b[0m" : `\x1b[31m${failures} check(s) failed\x1b[0m`}`,
);
process.exit(failures === 0 ? 0 : 1);
