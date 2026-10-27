/**
 * End-to-end build against the real API, with either engine.
 *
 * - Claude: needs ANTHROPIC_API_KEY in .env (Managed Agents session).
 * - OpenAI: needs `pnpm agent:login` (ChatGPT plan) or OPENAI_API_KEY in .env.
 * Pick with HOMEPAGE_ENGINE=claude|openai; otherwise whichever credentials exist.
 *
 * Exercises the exact orchestrator the extension runs, with a fixture/fetch
 * bridge standing in for chrome.history and chrome.tabs. Verifies: tools,
 * the engine's sandbox, the written deliverable, and cleanup.
 *
 * Run: pnpm agent:run [--resume]
 */
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { listModels, runHomepageBuild, type EngineId, type RunOptions, type TokenProvider } from "@homepage/agent-core";
import { FileKVStore, OUT_DIR, OUT_PATH, STATE_PATH, nodeBridge } from "./node-bridge";
import { harnessTokenProvider, loadCredentials } from "./siwc-credentials";

function chooseEngine(): EngineId {
  const forced = process.env.HOMEPAGE_ENGINE;
  if (forced === "claude" || forced === "openai") return forced;
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  if (process.env.OPENAI_API_KEY || loadCredentials()?.accessToken) return "openai";
  throw new Error("No credentials: set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env, or run pnpm agent:login");
}

async function main() {
  const engine = chooseEngine();
  const store = new FileKVStore(STATE_PATH);
  const resume = process.argv.includes("--resume");
  const common = { bridge: nodeBridge, store, userSystemPrompt: process.env.HOMEPAGE_PROMPT };

  let run: RunOptions;
  let model: string;
  if (engine === "claude") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set (put it in .env)");
    model = "(agent default)";
    run = {
      engine,
      client: new Anthropic({ apiKey }),
      resumeSessionId: resume ? await store.get<string>("activeSessionId") : undefined,
      ...common,
    };
  } else {
    const auth: TokenProvider = process.env.OPENAI_API_KEY
      ? { getAccessToken: async () => process.env.OPENAI_API_KEY! }
      : harnessTokenProvider();
    model = process.env.OPENAI_MODEL ?? (await listModels(await auth.getAccessToken()))[0]?.slug ?? "";
    if (!model) throw new Error("No model listed for these credentials; set OPENAI_MODEL in .env");
    run = { engine, auth, model, resume, ...common };
  }

  mkdirSync(OUT_DIR, { recursive: true });

  const started = Date.now();
  let lastPhase = "";

  const result = await runHomepageBuild({
    ...run,
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
  console.log(`engine       : ${result.engine}`);
  console.log(`id           : ${result.id}`);
  console.log(`model        : ${model}`);
  console.log(`source       : ${result.source}`);
  if (result.turns) console.log(`turns        : ${result.turns}`);
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

  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("\n[run-agent] fatal:", err);
  process.exit(1);
});
