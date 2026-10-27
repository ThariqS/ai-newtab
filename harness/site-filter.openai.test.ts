import { expect, test } from "bun:test";
import { OPENAI_STORAGE_KEYS as STORAGE_KEYS, OUTPUT_PATH, runHomepageBuild, type BrowserBridge, type BuildCheckpoint } from "@homepage/agent-core";
import { call, fakeOpenAI, memoryStore, message, outputsIn, staticAuth } from "./fake-openai";
import { fixtureHistory } from "./node-bridge";

/**
 * The site filter through the OpenAI engine's tool dispatch. The pure
 * normalize/isBlocked tests live in site-filter.test.ts (Claude engine).
 */
const COMPONENT = "import React from 'react';\nexport default function PersonalizedHomepage() { return null; }";

/**
 * Exercise live and resumed tool dispatch without a network or browser. The
 * model asks for getHistory, then getPageHtml, then writes and stops; on
 * resume both calls are already in the checkpoint, unanswered.
 */
async function runTools(urls: string[], blockedSites?: string[] | (() => Promise<string[]>), resume = false, afterHistory?: () => void, scrape?: BrowserBridge["getPageHtml"]) {
  const results: Array<{ call_id: string; output: string }> = [];
  const calls: string[][] = [];
  const logs: string[] = [];
  const history = call("getHistory", { maxResults: 1 });
  const pages = call("getPageHtml", { urls });

  const live = [
    () => ({ output: [history] }),
    (body: any) => {
      results.push(...outputsIn(body));
      afterHistory?.();
      return { output: [pages] };
    },
    (body: any) => {
      results.push(...outputsIn(body).slice(1));
      return { output: [call("write", { path: OUTPUT_PATH, content: COMPONENT })] };
    },
    () => ({ output: [message("done")] }),
  ];
  const resumed = [
    (body: any) => {
      results.push(...outputsIn(body));
      return { output: [call("write", { path: OUTPUT_PATH, content: COMPONENT })] };
    },
    () => ({ output: [message("done")] }),
  ];
  const api = fakeOpenAI(resume ? resumed : live);

  const checkpoint: BuildCheckpoint = {
    version: 1, buildId: "b", model: "m", startedAt: "", turn: 2,
    input: [{ role: "user", content: "go" }, history, pages], sandbox: { files: [] }, finalMessage: "",
  };
  const { store, writes } = memoryStore(resume ? { [STORAGE_KEYS.activeBuild]: checkpoint } : {});
  const bridge: BrowserBridge = {
    getHistory: async () => ({ sites: fixtureHistory(), totalSitesSeen: fixtureHistory().length }),
    getPageHtml: scrape ?? (async ({ urls }) => { calls.push(urls); return { pages: [], failed: urls.map(url => ({ url, reason: "unavailable" })) }; }),
  };
  await runHomepageBuild({ engine: "openai", auth: staticAuth().provider, fetch: api.fetch, store, bridge, model: "m", blockedSites, resume, callbacks: { onLog: line => logs.push(line) } });

  // What ended up mounted in the sandbox, read off the last checkpoint written.
  const lastCheckpoint = writes.filter(([k]) => k === STORAGE_KEYS.activeBuild).at(-1)?.[1] as BuildCheckpoint | undefined;
  const uploads = (lastCheckpoint?.sandbox.files ?? []).map(f => f.path).filter(p => p.includes("/uploads/"));
  const parsed = results.map(r => { try { return JSON.parse(r.output); } catch { return r.output; } });
  return { results: parsed, calls, logs, uploads };
}

test("filters history before capping and excludes blocked sites from the count", async () => {
  const { results } = await runTools([], ["news.ycombinator.com"]);
  const digest = results[0];
  expect(digest.totalSitesSeen).toBe(fixtureHistory().length - 1);
  expect(digest.sites).toHaveLength(1);
  expect(JSON.stringify(digest)).not.toContain("news.ycombinator.com");
});

test("uses newly saved blocked sites for the next tool call in an active build", async () => {
  let savedSites: string[] = [];
  const { results, calls } = await runTools(
    ["https://news.ycombinator.com"],
    async () => savedSites,
    false,
    () => { savedSites = ["news.ycombinator.com"]; },
  );
  expect(JSON.stringify(results[0])).toContain("news.ycombinator.com");
  expect(calls).toEqual([]);
  expect(results[1]).toEqual({
    pages: [],
    failed: [{ url: "https://news.ycombinator.com", reason: "blocked by the user's settings" }],
  });
});

test("never forwards blocked or non-http URLs, including on resume", async () => {
  const urls = ["https://bank.test", "https://sub.bank.test", "https:/bank.test", "https:\\bank.test", "file:///secret", "chrome://settings", "javascript:alert(1)", "not a url"];
  for (const resume of [false, true]) {
    const { results, calls, logs } = await runTools(urls, ["bank.test"], resume);
    expect(calls).toEqual([]);
    expect(results[1].error).toBeUndefined();
    expect(results[1]).toEqual({ pages: [], failed: urls.map(url => ({ url, reason: "blocked by the user's settings" })) });
    expect(logs).toContain("blocked: 8 url(s)");
  }
});

test("only forwards allowed URLs in mixed batches", async () => {
  const { results, calls } = await runTools(["https://bank.test", "https://public.test"], ["bank.test"]);
  expect(calls).toEqual([["https://public.test"]]);
  expect(results[1].failed).toEqual([
    { url: "https://bank.test", reason: "blocked by the user's settings" },
    { url: "https://public.test", reason: "unavailable" },
  ]);
});

test("uses defaults when unset and honors an explicitly empty list", async () => {
  expect((await runTools(["https://mail.google.com"])).calls).toEqual([]);
  expect((await runTools(["https://mail.google.com"], [])).calls).toEqual([["https://mail.google.com"]]);
});

test("drops pages that redirected to a blocked host before mounting them", async () => {
  const redirector = "https://www.google.com/url?q=https://mail.google.com/";
  const { results, uploads } = await runTools([redirector, "https://public.test/"], ["mail.google.com"], false, undefined, async ({ urls }) => ({
    pages: [
      { url: urls[0]!, finalUrl: "https://mail.google.com/mail/u/0/", title: "Inbox", html: "<p>secret</p>" },
      { url: urls[1]!, finalUrl: "https://public.test/", title: "Public", html: "<p>news</p>" },
    ],
    failed: [],
  }));
  const out = results[1];
  expect(uploads).toHaveLength(1);
  expect(out.pages.map((p: any) => p.url)).toEqual(["https://public.test/"]);
  expect(out.failed).toEqual([{ url: redirector, reason: "blocked by the user's settings" }]);
  expect(JSON.stringify(out)).not.toContain("Inbox");
});

test("drops pages served from a private address under a public-looking name", async () => {
  const urls = ["http://fritz.box/", "https://public.test/", "https://unknown.test/"];
  const { results, uploads } = await runTools(urls, [], false, undefined, async ({ urls }) => ({
    pages: [
      { url: urls[0]!, finalUrl: urls[0], ip: "192.168.179.1", title: "FRITZ!Box", html: "<p>router</p>" },
      { url: urls[1]!, finalUrl: urls[1], ip: "160.79.104.10", title: "Public", html: "<p>news</p>" },
      { url: urls[2]!, finalUrl: urls[2], title: "No address", html: "<p>kept</p>" },
    ],
    failed: [],
  }));
  const out = results[1];
  expect(uploads).toHaveLength(2);
  expect(out.pages.map((p: any) => p.url)).toEqual(["https://public.test/", "https://unknown.test/"]);
  expect(out.failed).toEqual([{ url: "http://fritz.box/", reason: "blocked by the user's settings" }]);
  expect(JSON.stringify(out)).not.toContain("FRITZ");
});
