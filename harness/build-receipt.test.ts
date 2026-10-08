import { expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import { runHomepageBuild, STORAGE_KEYS, type BrowserBridge, type KVStore } from "@homepage/agent-core";

async function* events(items: unknown[]) { yield* items; }

function fixture(usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number }) {
  const data = new Map<string, unknown>();
  const store: KVStore = {
    async get<T>(key: string) { return structuredClone(data.get(key)) as T | undefined; },
    async set(key, value) { data.set(key, structuredClone(value)); },
    async remove(key) { data.delete(key); },
  };
  const sent: any[] = [];
  const history: any[] = [];
  const live: any[] = [
    { id: "history", type: "agent.custom_tool_use", name: "getHistory", input: { daysToAnalyze: 7 } },
    { id: "pages", type: "agent.custom_tool_use", name: "getPageHtml", input: { urls: ["https://example.com", "https://failed.test"] } },
    { id: "done", type: "session.status_idle", stop_reason: { type: "end_turn" } },
  ];
  const client = {
    beta: {
      agents: { create: async () => ({ id: "agent", version: "1" }), retrieve: async () => ({}) },
      environments: { list: () => events([]), create: async () => ({ id: "env" }), retrieve: async () => ({}) },
      sessions: {
        create: async () => ({ id: "session" }),
        retrieve: async () => ({ status: "idle", usage }),
        delete: async () => {},
        events: {
          stream: async () => events(live), list: () => events(history),
          send: async (_id: string, body: any) => { sent.push(...body.events); },
        },
        resources: { add: async () => ({ mount_path: "/mnt/session/uploads/page.html" }) },
      },
      files: {
        upload: async () => ({ id: "upload" }), delete: async () => {},
        list: () => events([{ id: "output", filename: "homepage.tsx" }]),
        download: async () => ({ text: async () => "export default function PersonalizedHomepage() {}" }),
      },
    },
  };
  const bridge: BrowserBridge = {
    async getHistory() { return { totalSitesSeen: 12, sites: [{ domain: "example.com", totalVisits: 4, uniquePages: 1, lastVisitTime: 0, averageVisitsPerDay: 1, titles: ["Example"], urls: [], relevanceScore: 2 }] }; },
    async getPageHtml() { return { pages: [{ url: "https://example.com", title: "Example", html: "é" }], failed: [{ url: "https://failed.test", reason: "timeout" }] }; },
  };
  const run = (resumeSessionId?: string) => runHomepageBuild({ client: client as unknown as Anthropic, bridge, store, model: "claude-haiku-5-5", now: new Date("2026-10-08T12:00:00Z"), resumeSessionId });
  return { run, store, client, bridge, history, live, sent };
}

test("receipt records history, UTF-8 uploads, failures, timing and reported usage", async () => {
  const f = fixture({ input_tokens: 123, output_tokens: 45, cache_read_input_tokens: 67 });
  const { receipt } = await f.run();
  expect(receipt).toMatchObject({ startedAt: "2026-10-08T12:00:00.000Z", model: "claude-haiku-5-5", historyWindowDays: 7, domainsSent: ["example.com"], totalSitesSeen: 12, pagesUploaded: [{ url: "https://example.com", bytes: 2 }], pagesFailed: [{ url: "https://failed.test", reason: "timeout" }], usage: { inputTokens: 123, outputTokens: 45, cacheReadInputTokens: 67 } });
  expect(Number.isFinite(Date.parse(receipt.finishedAt))).toBe(true);
  expect(f.sent.filter(e => e.type === "user.custom_tool_result")).toHaveLength(2);
});

test("absent usage is omitted", async () => {
  expect((await fixture().run()).receipt).not.toHaveProperty("usage");
});

test("usage retrieval failure does not fail the build", async () => {
  const f = fixture();
  f.client.beta.sessions.retrieve = async () => { throw new Error("offline"); };
  expect((await f.run()).receipt).not.toHaveProperty("usage");
});

test("resuming preserves earlier receipt and original model", async () => {
  const f = fixture();
  const previous = { startedAt: "2026-10-07T12:00:00.000Z", finishedAt: "", model: "claude-opus-5-5", historyWindowDays: 14, domainsSent: ["earlier.test"], totalSitesSeen: 20, pagesUploaded: [{ url: "https://earlier.test", bytes: 50 }], pagesFailed: [{ url: "https://old.test", reason: "timeout" }] };
  await f.store.set(STORAGE_KEYS.buildReceipt, { sessionId: "session", receipt: previous });
  f.history.push({ id: "kickoff", type: "user.message", content: [] });
  const { receipt } = await f.run("session");
  expect(receipt.startedAt).toBe(previous.startedAt);
  expect(receipt.model).toBe(previous.model);
  expect(receipt.domainsSent).toEqual(["earlier.test", "example.com"]);
  expect(receipt.pagesUploaded).toEqual([...previous.pagesUploaded, { url: "https://example.com", bytes: 2 }]);
  expect(receipt.pagesFailed).toEqual([...previous.pagesFailed, { url: "https://failed.test", reason: "timeout" }]);
});

test("all-page failures still return a tool result and enter the receipt", async () => {
  const f = fixture();
  f.bridge.getPageHtml = async () => ({ pages: [], failed: [{ url: "https://failed.test", reason: "timeout" }] });
  const { receipt } = await f.run();
  expect(receipt.pagesFailed).toEqual([{ url: "https://failed.test", reason: "timeout" }]);
  expect(f.sent.find(e => e.custom_tool_use_id === "pages").is_error).toBe(true);
});

test("uploaded pages remain recorded when mounting fails", async () => {
  const f = fixture();
  f.client.beta.sessions.resources.add = async () => { throw new Error("mount unavailable"); };
  const { receipt } = await f.run();
  expect(receipt.pagesUploaded).toEqual([{ url: "https://example.com", bytes: 2 }]);
  expect(receipt.pagesFailed).toHaveLength(2);
  expect(f.sent.find(e => e.custom_tool_use_id === "pages").is_error).toBe(true);
});
