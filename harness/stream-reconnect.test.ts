import { expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import { runHomepageBuild, type BrowserBridge, type KVStore } from "@homepage/agent-core";
import { fixtureHistory } from "./node-bridge";

/**
 * The session stream can close mid-build, most often while a slow scrape is in
 * flight. That must reconnect and keep going, not read the homepage before the
 * agent has written it.
 */
test("reconnects when the stream closes before the session finishes", async () => {
  const log: any[] = [];
  const sent: any[] = [];
  let opened = 0;
  let written = false;

  const toolUse = { id: "pages", type: "agent.custom_tool_use", name: "getPageHtml", input: { urls: ["https://example.com/"] } };
  const message = { id: "msg", type: "agent.message", content: [{ type: "text", text: "Done." }] };
  const idle = { id: "idle", type: "session.status_idle", stop_reason: { type: "end_turn" } };

  // First stream: the tool call arrives, then the connection closes without a terminal event.
  // Second stream: the agent finishes.
  async function* stream(n: number) {
    if (n === 1) {
      log.push(toolUse);
      yield toolUse;
      return;
    }
    written = true;
    log.push(message, idle);
    yield message;
    yield idle;
  }

  const client = { beta: {
    agents: { retrieve: async () => ({}), update: async () => ({}) },
    environments: { retrieve: async () => ({}) },
    sessions: {
      create: async () => ({ id: "session" }),
      retrieve: async () => ({ status: "idle" }), delete: async () => {},
      resources: { add: async (_id: string, body: any) => ({ mount_path: body.mount_path }) },
      events: {
        stream: async () => stream(++opened),
        list: async function* () { yield* [...log]; },
        send: async (_id: string, body: any) => {
          sent.push(...body.events);
          log.push(...body.events.map((e: any, i: number) => ({ id: `user-${log.length + i}`, ...e })));
        },
      },
    },
    files: {
      list: async function* () { if (written) yield { id: "output", filename: "homepage.tsx" }; },
      download: async () => new Response("export default function PersonalizedHomepage() {}"),
      upload: async () => ({ id: "file-1" }),
      delete: async () => {},
    },
  } } as unknown as Anthropic;
  const store: KVStore = {
    get: async <T>(key: string) => (key === "uploadedFileIds" ? [] : "cached") as T,
    set: async () => {}, remove: async () => {},
  };
  const bridge: BrowserBridge = {
    getHistory: async () => ({ sites: fixtureHistory(), totalSitesSeen: fixtureHistory().length }),
    getPageHtml: async ({ urls }) => ({ pages: urls.map((url) => ({ url, title: "t", html: "<p>hi</p>" })), failed: [] }),
  };

  const result = await runHomepageBuild({ client, store, bridge });

  expect(opened).toBe(2);
  expect(result.code).toContain("PersonalizedHomepage");
  // Kicked off once, and the tool call answered once, across both connections.
  expect(sent.filter((e) => e.type === "user.message")).toHaveLength(1);
  expect(sent.filter((e) => e.type === "user.custom_tool_result")).toHaveLength(1);
});

/**
 * A dropped connection can also break the send of a tool result. That call must
 * still get its result on reconnect — the same one, without scraping again.
 */
test("resends a tool result whose send failed, without re-running the tool", async () => {
  const log: any[] = [];
  const delivered: any[] = [];
  let opened = 0;
  let scrapes = 0;
  let failNextResult = true;

  const toolUse = { id: "pages", type: "agent.custom_tool_use", name: "getPageHtml", input: { urls: ["https://example.com/"] } };
  const message = { id: "msg", type: "agent.message", content: [{ type: "text", text: "Done." }] };
  const idle = { id: "idle", type: "session.status_idle", stop_reason: { type: "end_turn" } };

  async function* stream(n: number) {
    if (n === 1) {
      log.push(toolUse);
      yield toolUse;
      return;
    }
    // The session only moves on once the pending call has its result.
    if (!log.some((e) => e.type === "user.custom_tool_result")) return;
    log.push(message, idle);
    yield message;
    yield idle;
  }

  const client = { beta: {
    agents: { retrieve: async () => ({}), update: async () => ({}) },
    environments: { retrieve: async () => ({}) },
    sessions: {
      create: async () => ({ id: "session" }),
      retrieve: async () => ({ status: "idle" }), delete: async () => {},
      resources: { add: async (_id: string, body: any) => ({ mount_path: body.mount_path }) },
      events: {
        stream: async () => stream(++opened),
        list: async function* () { yield* [...log]; },
        send: async (_id: string, body: any) => {
          if (failNextResult && body.events.some((e: any) => e.type === "user.custom_tool_result")) {
            failNextResult = false;
            throw new Error("socket hang up");
          }
          delivered.push(...body.events);
          log.push(...body.events.map((e: any, i: number) => ({ id: `user-${log.length + i}`, ...e })));
        },
      },
    },
    files: {
      list: async function* () { if (log.includes(idle)) yield { id: "output", filename: "homepage.tsx" }; },
      download: async () => new Response("export default function PersonalizedHomepage() {}"),
      upload: async () => ({ id: "file-1" }),
      delete: async () => {},
    },
  } } as unknown as Anthropic;
  const store: KVStore = {
    get: async <T>(key: string) => (key === "uploadedFileIds" ? [] : "cached") as T,
    set: async () => {}, remove: async () => {},
  };
  const bridge: BrowserBridge = {
    getHistory: async () => ({ sites: fixtureHistory(), totalSitesSeen: fixtureHistory().length }),
    getPageHtml: async ({ urls }) => {
      scrapes++;
      return { pages: urls.map((url) => ({ url, title: "t", html: "<p>hi</p>" })), failed: [] };
    },
  };

  const result = await runHomepageBuild({ client, store, bridge });

  expect(result.code).toContain("PersonalizedHomepage");
  expect(scrapes).toBe(1);
  const results = delivered.filter((e) => e.type === "user.custom_tool_result");
  expect(results).toHaveLength(1);
  expect(results[0].custom_tool_use_id).toBe("pages");
  expect(results[0].is_error).toBeUndefined();
});
