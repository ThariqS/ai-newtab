import { expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import { isBlocked, normalizeBlockList, runHomepageBuild, type BrowserBridge, type KVStore } from "@homepage/agent-core";
import { fixtureHistory } from "./node-bridge";

test("normalizes pasted hosts and URLs", () => {
  expect(normalizeBlockList([" HTTPS://WWW.Google.COM/path ", "", " # comment", "*.Example.COM", "google.com"])).toEqual(["google.com", "*.example.com"]);
});

test("matches hosts and subdomains without matching lookalikes", () => {
  for (const host of ["google.com", "mail.google.com", "https://WWW.GOOGLE.COM./path"]) {
    expect(isBlocked(host, ["google.com"])).toBe(true);
  }
  expect(isBlocked("deep.sub.example.com", ["*.example.com"])).toBe(true);
  expect(isBlocked("example.com", ["*.example.com"])).toBe(true);
  for (const url of ["https:/mail.google.com", "https:\\mail.google.com", "HTTPS://user:pw@Mail.Google.com:443/x"]) {
    expect(isBlocked(url, ["google.com"])).toBe(true);
  }
  expect(isBlocked("localhost:3000", ["localhost"])).toBe(true);
  expect(isBlocked("notgoogle.com", ["google.com"])).toBe(false);
  expect(isBlocked("google.com.evil.test", ["google.com"])).toBe(false);
});

/** Exercise live and replayed tool dispatch without a network or browser. */
async function runTools(urls: string[], blockedSites?: string[] | (() => Promise<string[]>), resume = false, afterHistory?: () => void) {
  const results: any[] = [];
  const calls: string[][] = [];
  const logs: string[] = [];
  const events = [
    { id: "history", type: "agent.custom_tool_use", name: "getHistory", input: { maxResults: 1 } },
    { id: "pages", type: "agent.custom_tool_use", name: "getPageHtml", input: { urls } },
  ];
  async function* stream() { if (!resume) yield* events; }
  const client = { beta: {
    agents: { retrieve: async () => ({}) },
    environments: { retrieve: async () => ({}) },
    sessions: {
      create: async () => ({ id: "session" }),
      retrieve: async () => ({ status: "idle" }), delete: async () => {},
      events: {
        stream: async () => stream(),
        list: async function* () { if (resume) yield* events; },
        send: async (_id: string, body: any) => {
          const toolResults = body.events.filter((e: any) => e.type === "user.custom_tool_result");
          results.push(...toolResults);
          if (toolResults.some((e: any) => e.custom_tool_use_id === "history")) afterHistory?.();
        },
      },
    },
    files: {
      list: async function* () { yield { id: "output", filename: "homepage.tsx" }; },
      download: async () => new Response("export default function PersonalizedHomepage() {}"),
    },
  } } as unknown as Anthropic;
  const store: KVStore = {
    get: async <T>(key: string) => (key === "uploadedFileIds" ? [] : "cached") as T,
    set: async () => {}, remove: async () => {},
  };
  const bridge: BrowserBridge = {
    getHistory: async () => ({ sites: fixtureHistory(), totalSitesSeen: fixtureHistory().length }),
    getPageHtml: async ({ urls }) => { calls.push(urls); return { pages: [], failed: urls.map(url => ({ url, reason: "unavailable" })) }; },
  };
  await runHomepageBuild({ client, store, bridge, blockedSites, resumeSessionId: resume ? "session" : undefined, callbacks: { onLog: line => logs.push(line) } });
  return { results, calls, logs };
}

test("filters history before capping and excludes blocked sites from the count", async () => {
  const { results } = await runTools([], ["news.ycombinator.com"]);
  const digest = JSON.parse(results[0].content[0].text);
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
  expect(JSON.stringify(JSON.parse(results[0].content[0].text))).toContain("news.ycombinator.com");
  expect(calls).toEqual([]);
  expect(JSON.parse(results[1].content[0].text)).toEqual({
    pages: [],
    failed: [{ url: "https://news.ycombinator.com", reason: "blocked by the user's settings" }],
  });
});

test("never forwards blocked or non-http URLs, including on resume", async () => {
  const urls = ["https://bank.test", "https://sub.bank.test", "https:/bank.test", "https:\\bank.test", "file:///secret", "chrome://settings", "javascript:alert(1)", "not a url"];
  for (const resume of [false, true]) {
    const { results, calls, logs } = await runTools(urls, ["bank.test"], resume);
    expect(calls).toEqual([]);
    expect(results[1].is_error).toBeUndefined();
    expect(JSON.parse(results[1].content[0].text)).toEqual({ pages: [], failed: urls.map(url => ({ url, reason: "blocked by the user's settings" })) });
    expect(logs).toContain("blocked: 8 url(s)");
  }
});

test("only forwards allowed URLs in mixed batches", async () => {
  const { results, calls } = await runTools(["https://bank.test", "https://public.test"], ["bank.test"]);
  expect(calls).toEqual([["https://public.test"]]);
  expect(JSON.parse(results[1].content[0].text).failed).toEqual([
    { url: "https://bank.test", reason: "blocked by the user's settings" },
    { url: "https://public.test", reason: "unavailable" },
  ]);
});

test("uses defaults when unset and honors an explicitly empty list", async () => {
  expect((await runTools(["https://mail.google.com"])).calls).toEqual([]);
  expect((await runTools(["https://mail.google.com"], [])).calls).toEqual([["https://mail.google.com"]]);
});
