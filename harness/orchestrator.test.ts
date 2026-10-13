import { describe, expect, test } from "bun:test";
import {
  OPENAI_STORAGE_KEYS as STORAGE_KEYS,
  OUTPUT_PATH,
  runHomepageBuild,
  type BrowserBridge,
  type BuildCheckpoint,
  type OutputItem,
} from "@homepage/agent-core";
import { call, fakeOpenAI, memoryStore, message, outputsIn, reasoning, staticAuth } from "./fake-openai";
import { fixtureHistory } from "./node-bridge";

const COMPONENT = `import React from 'react';\nexport default function PersonalizedHomepage() { return <a href="https://news.ycombinator.com/">HN</a>; }`;

const bridge: BrowserBridge = {
  getHistory: async () => ({ sites: fixtureHistory(), totalSitesSeen: fixtureHistory().length }),
  getPageHtml: async ({ urls }) => ({
    pages: urls.map((url) =>
      url.includes("reddit")
        ? { url, finalUrl: url, title: "homelab", html: `<div class="thing"><a href="/r/homelab/comments/1/x/">A thread</a></div>` }
        : {
            url,
            finalUrl: url,
            title: "Hacker News",
            html: `<h1>Hacker News</h1>\n<a href="https://example.org/story/1">First story</a>\n<p>filler</p>\n<a href="/item?id=2">Second</a>`,
          },
    ),
    failed: [],
  }),
};

describe("runHomepageBuild (local loop)", () => {
  test("drives tools through the Responses API and delivers the written file", async () => {
    const api = fakeOpenAI([
      () => ({ output: [reasoning("enc_1"), call("getHistory", { maxResults: 5 })] }),
      (body) => {
        const digest = JSON.parse(outputsIn(body)[0].output);
        expect(digest.sites).toHaveLength(5);
        return { output: [call("getPageHtml", { urls: ["https://news.ycombinator.com/", "https://old.reddit.com/r/homelab/"] }, { namespace: "homepage" })] };
      },
      (body) => {
        const pages = JSON.parse(outputsIn(body)[1].output);
        expect(pages.pages[0].mountPath).toBe("/mnt/session/uploads/pages/news_ycombinator_com_0.html");
        expect(pages.pages[1].mountPath).toBe("/mnt/session/uploads/pages/old_reddit_com_1.html");
        return {
          output: [
            call("homepage.grep", { pattern: "href=", path: pages.pages[0].mountPath }),
            call("read", { path: pages.pages[0].mountPath, limit: 2 }),
            call("glob", { pattern: "*.html" }),
            call("grep", { pattern: "href=", path: pages.pages[1].mountPath }),
          ],
        };
      },
      (body) => {
        const [grep, read, glob, redditGrep] = outputsIn(body).slice(-4).map((o) => o.output);
        expect(grep).toContain(":2:");
        expect(grep).toContain("example.org/story/1");
        expect(read).toMatch(/^1\t<h1>Hacker News<\/h1>\n2\t/);
        expect(read).toContain("[showing lines 1-2 of 4");
        expect(glob).toBe("/mnt/session/uploads/pages/news_ycombinator_com_0.html\n/mnt/session/uploads/pages/old_reddit_com_1.html");
        // Links read through old.reddit.com are absolutized and point the reader at www.
        expect(redditGrep).toContain('href="https://www.reddit.com/r/homelab/comments/1/x/"');
        expect(redditGrep).not.toContain("old.reddit.com");
        return { output: [call("write", { path: OUTPUT_PATH, content: COMPONENT })] };
      },
      (body) => {
        expect(JSON.parse(outputsIn(body).at(-1)!.output)).toEqual({ ok: true, path: OUTPUT_PATH, bytes: COMPONENT.length });
        return { output: [message("Built a one-link homepage. Because tests.")] };
      },
    ]);
    const { store, data } = memoryStore();
    const phases: string[] = [];
    let text = "";

    const result = await runHomepageBuild({
      engine: "openai",
      auth: staticAuth().provider,
      bridge,
      store,
      model: "gpt-test",
      fetch: api.fetch,
      callbacks: { onPhase: (p) => phases.push(p), onText: (t) => (text += t) },
    });

    expect(result.code).toBe(COMPONENT);
    expect(result.source).toBe("output-file");
    expect(result.turns).toBe(5);
    expect(text).toContain("Built a one-link homepage");
    expect(phases).toEqual(expect.arrayContaining(["setup", "thinking", "history", "scraping", "analyzing", "writing", "done", "cleanup"]));
    // Checkpoint is gone once the build completes.
    expect(data.has(STORAGE_KEYS.activeBuild)).toBe(false);

    // Every request obeys the SIWC contract.
    for (const req of api.requests) {
      expect(req.store).toBe(false);
      expect(req.stream).toBe(true);
      expect(Array.isArray(req.input)).toBe(true);
      expect(req.previous_response_id).toBeUndefined();
      expect(req.temperature).toBeUndefined();
      expect(req.max_output_tokens).toBeUndefined();
      expect(req.instructions).toContain("PersonalizedHomepage");
      expect(req.input.some((i: any) => i.role === "system")).toBe(false);
      expect(req.tools).toHaveLength(1);
      expect(req.tools[0].type).toBe("namespace");
      expect(req.tools[0].tools.map((t: any) => t.name)).toEqual(["getHistory", "getPageHtml", "grep", "read", "glob", "write"]);
    }
    // History is replayed in full: the reasoning item with encrypted content survives, the kickoff stays first.
    const last = api.requests.at(-1);
    expect(last.input[0].role).toBe("user");
    expect(last.input.filter((i: any) => i.type === "reasoning")).toHaveLength(1);
    expect(last.input.filter((i: any) => i.type === "function_call")).toHaveLength(7);
    expect(last.input.filter((i: any) => i.type === "function_call_output")).toHaveLength(7);
  });

  test("resumes from a checkpoint and re-answers the orphaned tool call", async () => {
    const orphan = call("getPageHtml", { urls: ["https://news.ycombinator.com/"] });
    const checkpoint: BuildCheckpoint = {
      version: 1,
      buildId: "build_test",
      model: "gpt-from-checkpoint",
      startedAt: new Date().toISOString(),
      turn: 2,
      input: [{ role: "user", content: "Build today's homepage." }, orphan],
      sandbox: { files: [] },
      finalMessage: "",
    };
    const api = fakeOpenAI([
      (body) => {
        expect(body.model).toBe("gpt-from-checkpoint");
        const outputs = outputsIn(body);
        expect(outputs).toHaveLength(1);
        expect(outputs[0].call_id).toBe(orphan.call_id);
        return { output: [call("write", { path: OUTPUT_PATH, content: COMPONENT })] };
      },
      () => ({ output: [message("done")] }),
    ]);
    const { store } = memoryStore({ [STORAGE_KEYS.activeBuild]: checkpoint });
    const logs: string[] = [];
    const result = await runHomepageBuild({
      engine: "openai",
      auth: staticAuth().provider,
      bridge,
      store,
      model: "ignored-on-resume",
      resume: true,
      fetch: api.fetch,
      callbacks: { onLog: (l) => logs.push(l) },
    });
    expect(result.id).toBe("build_test");
    expect(result.turns).toBe(4);
    expect(logs.some((l) => l.startsWith("re-answering orphaned tool call"))).toBe(true);
  });

  test("refreshes the token after a 401 and retries the turn once", async () => {
    const api = fakeOpenAI([
      () => ({ httpStatus: 401, error: { message: "token expired" } }),
      () => ({ output: [call("write", { path: OUTPUT_PATH, content: COMPONENT })] }),
      () => ({ output: [message("ok")] }),
    ]);
    const { store } = memoryStore();
    await runHomepageBuild({ engine: "openai", auth: staticAuth().provider, bridge, store, model: "gpt-test", fetch: api.fetch });
    expect(api.tokens).toEqual(["Bearer tok_initial", "Bearer tok_refreshed", "Bearer tok_initial"]);
  });

  test("falls back through tool deliveries when the route rejects the shape, and remembers it", async () => {
    const api = fakeOpenAI([
      () => ({ httpStatus: 400, error: { code: "subscription_sharing_unsupported_capability", param: "tools", message: "unsupported" } }),
      (body) => {
        expect(body.tools).toBeUndefined();
        expect(body.input[0].type).toBe("additional_tools");
        return { httpStatus: 400, error: { code: "subscription_sharing_unsupported_capability", param: "input[0]", message: "unsupported" } };
      },
      (body) => {
        expect(body.tools.map((t: any) => t.type)).toEqual(Array(6).fill("function"));
        return { httpStatus: 400, error: { message: "Unknown parameter: 'include'", param: "include" } };
      },
      (body) => {
        expect(body.include).toBeUndefined();
        return { output: [call("write", { path: OUTPUT_PATH, content: COMPONENT })] };
      },
      (body) => {
        // The next turn starts from the learned shape, no re-probing.
        expect(body.tools.map((t: any) => t.type)).toEqual(Array(6).fill("function"));
        return { output: [message("ok")] };
      },
    ]);
    const { store, data } = memoryStore();
    await runHomepageBuild({ engine: "openai", auth: staticAuth().provider, bridge, store, model: "gpt-test", fetch: api.fetch });
    expect(data.get(STORAGE_KEYS.apiCompat)).toEqual({ toolDelivery: "flat", includeReasoning: false });
    expect(api.requests).toHaveLength(5);
  });

  test("surfaces a mid-stream usage-limit failure with the documented meaning", async () => {
    const api = fakeOpenAI([() => ({ failed: { code: "subscription_sharing_usage_limit_exceeded" } })]);
    const { store, data } = memoryStore();
    const run = runHomepageBuild({ engine: "openai", auth: staticAuth().provider, bridge, store, model: "gpt-test", fetch: api.fetch });
    await expect(run).rejects.toThrow(/usage limit/i);
    expect(data.has(STORAGE_KEYS.activeBuild)).toBe(false);
  });

  test("turns a tool failure into an error output instead of breaking the loop", async () => {
    const api = fakeOpenAI([
      () => ({ output: [call("read", { path: "/nowhere.html" }), call("write", { path: "/etc/passwd", content: "x" })] }),
      (body) => {
        const [read, write] = outputsIn(body).map((o) => JSON.parse(o.output));
        expect(read.error).toMatch(/No such file/);
        expect(write.error).toMatch(/Only files under \/mnt\/session\/outputs/);
        return { output: [message("```tsx\nimport React from 'react';\nexport default function PersonalizedHomepage() { return null; }\n```")] };
      },
    ]);
    const { store } = memoryStore();
    const result = await runHomepageBuild({ engine: "openai", auth: staticAuth().provider, bridge, store, model: "gpt-test", fetch: api.fetch });
    expect(result.source).toBe("message-fence");
    expect(result.code).toContain("PersonalizedHomepage");
  });

  test("rebuilds output items from the stream when response.completed carries none", async () => {
    const api = fakeOpenAI([
      () => ({ output: [call("write", { path: OUTPUT_PATH, content: COMPONENT })], slimCompleted: true }),
      (body) => {
        expect(outputsIn(body)).toHaveLength(1);
        return { output: [message("streamed only")], slimCompleted: true };
      },
    ]);
    const { store } = memoryStore();
    let text = "";
    const result = await runHomepageBuild({
      engine: "openai",
      auth: staticAuth().provider, bridge, store, model: "gpt-test", fetch: api.fetch,
      callbacks: { onText: (t) => (text += t) },
    });
    expect(result.code).toBe(COMPONENT);
    expect(text).toBe("streamed only");
  });

  test("nudges the model after an empty turn instead of failing", async () => {
    const api = fakeOpenAI([
      () => ({ output: [reasoning()] }),
      (body) => {
        expect(body.input.at(-1)).toEqual({ role: "user", content: expect.stringContaining("no tool call and no text") });
        return { output: [call("write", { path: OUTPUT_PATH, content: COMPONENT })] };
      },
      () => ({ output: [message("done")] }),
    ]);
    const { store } = memoryStore();
    const logs: string[] = [];
    const result = await runHomepageBuild({ engine: "openai", auth: staticAuth().provider, bridge, store, model: "gpt-test", fetch: api.fetch, callbacks: { onLog: (l) => logs.push(l) } });
    expect(result.turns).toBe(3);
    expect(logs.some((l) => l.startsWith("empty turn"))).toBe(true);
    expect(logs.some((l) => l.includes("turn 2: 1 item(s): function_call write"))).toBe(true);
  });

  test("fails with a readable message after repeated empty turns", async () => {
    const api = fakeOpenAI(Array.from({ length: 5 }, () => () => ({ output: [] as OutputItem[] })));
    const { store } = memoryStore();
    await expect(runHomepageBuild({ engine: "openai", auth: staticAuth().provider, bridge, store, model: "gpt-test", fetch: api.fetch })).rejects.toThrow(/produced no homepage/);
    expect(api.requests).toHaveLength(3);
  });

  test("stops after maxTurns rather than looping forever", async () => {
    const api = fakeOpenAI(Array.from({ length: 10 }, () => () => ({ output: [call("glob", { pattern: "*" })] })));
    const { store } = memoryStore();
    await expect(
      runHomepageBuild({ engine: "openai", auth: staticAuth().provider, bridge, store, model: "gpt-test", fetch: api.fetch, maxTurns: 3 }),
    ).rejects.toThrow(/3 model turns/);
    expect(api.requests).toHaveLength(3);
  });
});
