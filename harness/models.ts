/**
 * List the models the signed-in ChatGPT account offers to apps (GET /models,
 * visibility "list", server order). The first one is the default the harness
 * and the extension build with when nothing is chosen.
 *
 * Run: pnpm agent:models
 */
import { listModels } from "@homepage/agent-core";
import { harnessTokenProvider } from "./siwc-credentials";

const models = await listModels(await harnessTokenProvider().getAccessToken());
if (models.length === 0) {
  console.log("No models with visibility=list were returned.");
} else {
  for (const [i, m] of models.entries()) console.log(`${i === 0 ? "* " : "  "}${m.slug.padEnd(28)} ${m.displayName}`);
  console.log(`\n* = default. Pick one with OPENAI_MODEL=<slug> in .env.`);
}
