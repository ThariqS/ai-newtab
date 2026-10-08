/**
 * End-to-end build against the real API (needs ANTHROPIC_API_KEY in .env).
 *
 * Exercises the exact orchestrator the extension runs, with a fixture/fetch
 * bridge standing in for chrome.history and chrome.tabs. Verifies: agent +
 * environment reuse, session lifecycle, custom-tool dispatch, mid-session file
 * mounting, sandbox grep/read, the written deliverable, and cleanup.
 *
 * Run: pnpm agent:run
 */
import Anthropic from "@anthropic-ai/sdk";
import { runHomepageBuild } from "@homepage/agent-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { FileKVStore, OUT_DIR, OUT_PATH, STATE_PATH, nodeBridge } from "./node-bridge";

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set (put it in .env)");

  const client = new Anthropic({ apiKey });
  const store = new FileKVStore(STATE_PATH);

  mkdirSync(OUT_DIR, { recursive: true });

  const started = Date.now();
  let lastPhase = "";

  const result = await runHomepageBuild({
    client,
    bridge: nodeBridge,
    store,
    userSystemPrompt: process.env.HOMEPAGE_PROMPT,
    callbacks: {
      onPhase: (phase, detail) => {
        if (phase !== lastPhase) {
          lastPhase = phase;
          process.stdout.write(`\n\x1b[36m[${phase}]\x1b[0m${detail ? " " + detail : ""}\n`);
        }
      },
      onText: (text) => process.stdout.write(text),
      onLog: (line) => process.stdout.write(`\n\x1b[90m  · ${line}\x1b[0m\n`),
    },
  });

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  writeFileSync(OUT_PATH, result.code);

  console.log("\n\n========== RESULT ==========");
  console.log(`session      : ${result.sessionId}`);
  console.log(`source       : ${result.source}`);
  console.log(`code length  : ${result.code.length} bytes`);
  console.log(`elapsed      : ${elapsed}s`);
  console.log(`written to   : ${OUT_PATH}`);

  // Shape checks. The real proof is `pnpm agent:verify`, which
  // transforms, evaluates and server-renders the component.
  const checks: Array<[string, boolean]> = [
    // `export default function PersonalizedHomepage()` and
    // `export default PersonalizedHomepage;` are both valid.
    ["default-exports the component", /export\s+default\s+(function\s+)?PersonalizedHomepage\b/.test(result.code)],
    ["imports React", /import\s+React/.test(result.code)],
    ["no non-React imports", !/from\s+['"](?!react['"])[^'"]+['"]/.test(result.code)],
    ["has real hrefs", /https?:\/\//.test(result.code)],
  ];

  console.log("\n========== CONTRACT ==========");
  let ok = true;
  for (const [label, pass] of checks) {
    console.log(`${pass ? "✅" : "❌"} ${label}`);
    if (!pass) ok = false;
  }
  console.log(`\nNext: pnpm agent:verify`);

  console.log(JSON.stringify(result.receipt, null, 2));

  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("\n[run-agent] fatal:", err);
  process.exit(1);
});
