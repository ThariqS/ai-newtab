/**
 * Loads the built extension into a real (headless) Chrome and verifies the half
 * of the system the Bun harness can't reach:
 *
 *   1. the MV3 service worker registers,
 *   2. the new-tab override renders (the engine setup screen on a fresh profile),
 *   3. the worker answers `subscribe` on the build port with a snapshot,
 *   4. `startBuild` with no API key fails cleanly with an error message,
 *   5. `chrome.history` is readable, so the `history` permission is real,
 *   6. a ChatGPT usage limit hit mid-build becomes a notice, not an error: it
 *      survives a worker restart, links to the usage page, its API-key button
 *      opens the key setup, and dismissing it sticks.
 *
 * No API calls are made: step 6 runs against fake ChatGPT credentials in the
 * throwaway profile, with the worker's `fetch` stubbed to answer the way the
 * ChatGPT-plan route does when the limit is reached. Chrome 136+ ignores `--load-extension`, so the
 * extension is loaded over CDP's Extensions domain instead.
 *
 * Run: pnpm build && pnpm extension:test
 * Set CHROME_PATH to pick a Chrome. Without it, a Chrome for Testing build left
 * by Playwright or Puppeteer is preferred over the installed Chrome: headless
 * sessions of Chrome 156 stable on macOS quit on their own after about 31 s.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH ?? chromeForTesting() ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** A Chrome for Testing build from the Playwright or Puppeteer cache (macOS layout), if there is one. */
function chromeForTesting(): string | undefined {
  const home = process.env.HOME ?? "";
  const roots = [join(home, "Library/Caches/ms-playwright"), join(home, ".cache/puppeteer/chrome")];
  const found: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root)) {
      const app = join(root, dir, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
      if (existsSync(app)) found.push(app);
    }
  }
  return found.sort().at(-1);
}
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

  // ---- 6. usage limit → notice, not error ----------------------------------
  const settle = async (ms = 2500) => {
    await sleep(ms);
    return page.evaluate<string>("document.body.innerText");
  };
  const reload = async () => {
    await page.send("Page.reload", {});
    return settle(3000);
  };

  // Fake sign-in in the throwaway profile: a token that won't need a refresh,
  // with the plan-usage scope, so the OpenAI engine counts as ready.
  await page.evaluate(`
    chrome.storage.local.set({
      engine: "openai",
      openaiAuthMode: "siwc",
      siwcCredentials: {
        email: "tester@example.com",
        issuer: "https://auth.openai.com",
        subject: "user-test",
        clientId: "oaiapp_test",
        hostId: "urn:uuid:00000000-0000-4000-8000-000000000000",
        idToken: null,
        accessToken: "fake-access-token",
        refreshToken: null,
        tokenType: "Bearer",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        scopes: ["openid", "offline_access", "chatgpt.tokens.use.direct"],
        savedAt: new Date().toISOString(),
      },
    })
  `);

  // The worker answers /v1/responses the way the ChatGPT-plan route did for a
  // real user: HTTP 200, then a mid-stream `error` event with nested details.
  const swTargets: any[] = await getJson("/json/list");
  const swTarget = swTargets.find((t) => t.type === "service_worker" && t.url.includes(extId));
  const worker = await cdp(swTarget.webSocketDebuggerUrl);
  const patched = await worker.evaluate<string>(`
    (() => {
      globalThis.__realFetch ??= globalThis.fetch;
      globalThis.__responsesCalls = 0;
      globalThis.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.startsWith("https://api.openai.com/v1/responses")) {
          globalThis.__responsesCalls++;
          const created = { type: "response.created", response: { id: "resp_test", status: "in_progress", output: [] } };
          const error = {
            type: "error",
            error: {
              type: "invalid_request_error",
              code: "subscription_sharing_usage_limit_exceeded",
              message: "The ChatGPT user has reached their Subscription Sharing usage limit.",
              param: null,
            },
            sequence_number: 3,
          };
          const body = "event: response.created\\ndata: " + JSON.stringify(created) + "\\n\\nevent: error\\ndata: " + JSON.stringify(error) + "\\n\\n";
          return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
        }
        return globalThis.__realFetch(input, init);
      };
      return "patched";
    })()
  `);

  const limited = await talk({ kind: "startBuild" }, 5000);
  const notice = limited.find((m) => m.kind === "notice");
  const calls = await worker.evaluate<number>("globalThis.__responsesCalls");
  check(
    "a usage limit mid-build ends the build with a notice, not an error, and is not retried",
    patched === "patched" && notice?.notice?.kind === "usage-limit" && !limited.some((m) => m.kind === "error") && calls === 1,
    JSON.stringify({ notice: notice?.notice?.kind, error: limited.find((m) => m.kind === "error")?.message, calls }),
  );
  worker.close();

  // The worker is unloaded long before anyone looks; the notice must survive that.
  await page.send("ServiceWorker.enable");
  await page.send("ServiceWorker.stopAllWorkers");
  await sleep(500);
  let text = await reload();
  // Proof the worker really restarted: the stub lived on the old instance's global.
  const freshTargets: any[] = await getJson("/json/list");
  const freshTarget = freshTargets.find((t) => t.type === "service_worker" && t.url.includes(extId));
  const freshWorker = freshTarget ? await cdp(freshTarget.webSocketDebuggerUrl) : null;
  const stubGone = (await freshWorker?.evaluate<string>("typeof globalThis.__responsesCalls")) === "undefined";
  freshWorker?.close();
  const usageHref = await page.evaluate<string | null>(
    `document.querySelector('[data-testid="usage-link"]')?.getAttribute("href") ?? null`,
  );
  check(
    "after a worker restart the page shows the usage-limit notice instead of an error",
    stubGone && /ChatGPT usage limit reached/.test(text) && !/Build failed/i.test(text),
    `fresh worker=${stubGone}; ${text.split("\n").filter((l) => /usage limit/i.test(l))[0]?.slice(0, 60)}`,
  );
  const shot = await page.send("Page.captureScreenshot", { format: "png" });
  if (shot.result?.data) {
    mkdirSync(join(import.meta.dir, "out"), { recursive: true });
    writeFileSync(join(import.meta.dir, "out", "usage-limit-panel.png"), Buffer.from(shot.result.data, "base64"));
  }
  check("the notice links to the ChatGPT usage page", usageHref === "https://chatgpt.com/settings/usage", usageHref ?? "no link");

  await page.evaluate(`document.querySelector('[data-testid="use-api-key"]').click()`);
  text = await settle();
  const mode = await page.evaluate<string>(`chrome.storage.local.get("openaiAuthMode").then((r) => r.openaiAuthMode)`);
  check(
    "'Use an OpenAI API key' switches to API-key billing and opens the key setup",
    mode === "apiKey" && /Connect your OpenAI API key/.test(text),
    `mode=${mode}`,
  );

  // Back on the ChatGPT plan, the notice is still there until dismissed; dismissing sticks.
  await page.evaluate(`chrome.storage.local.set({ openaiAuthMode: "siwc" })`);
  text = await reload();
  const before = /ChatGPT usage limit reached/.test(text);
  const dismissed = await talk({ kind: "dismissNotice" }, 800);
  text = await reload();
  check(
    "dismissing the notice clears it for good",
    before && dismissed.some((m) => m.kind === "snapshot" && m.state.notice === null) && !/ChatGPT usage limit reached/.test(text),
    `before=${before}`,
  );

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
