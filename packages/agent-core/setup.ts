import type Anthropic from "@anthropic-ai/sdk";
import { HOMEPAGE_SYSTEM_PROMPT } from "./prompt";
import { GET_HISTORY_SCHEMA, GET_PAGE_HTML_SCHEMA } from "./schemas";
import type { KVStore } from "./types";

/** Models offered in Settings. The first is the default. */
export const MODEL_CHOICES = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
] as const;

export type HomepageModel = (typeof MODEL_CHOICES)[number]["id"];

export const DEFAULT_MODEL: HomepageModel = "claude-sonnet-5-5";

/**
 * An agent is pinned to its model, so each model gets its own cached agent.
 * Switching back and forth reuses them instead of provisioning a new one per switch.
 */
export function agentIdKey(model: HomepageModel): string {
  return `agentId-${model.replace(/^claude-/, "")}`;
}

export const STORAGE_KEYS = {
  apiKey: "apiKey",
  agentVersion: "agentVersion",
  environmentId: "environmentId",
  activeSessionId: "activeSessionId",
  uploadedFileIds: "uploadedFileIds",
} as const;

const ENVIRONMENT_NAME = "homepage-builder-env";
const AGENT_NAME = "homepage-builder";

/**
 * Agents and environments are persistent, versioned objects — not per-run
 * parameters. Create them once, cache the IDs, and reuse them; creating one per
 * build silently accumulates orphans and pays creation latency every run.
 */
export async function ensureEnvironment(
  client: Anthropic,
  store: KVStore,
): Promise<string> {
  const cached = await store.get<string>(STORAGE_KEYS.environmentId);
  if (cached) {
    // Verify it still exists — an archived/deleted env fails at session create,
    // which is a much more confusing place to discover it.
    try {
      const env = await client.beta.environments.retrieve(cached);
      if (!env.archived_at) return cached;
    } catch {
      await store.remove(STORAGE_KEYS.environmentId);
    }
  }

  // Environment names are unique per org: adopt an existing one before creating.
  for await (const env of client.beta.environments.list()) {
    if (env.name === ENVIRONMENT_NAME && !env.archived_at) {
      await store.set(STORAGE_KEYS.environmentId, env.id);
      return env.id;
    }
  }

  const env = await client.beta.environments.create({
    name: ENVIRONMENT_NAME,
    description: "Sandbox for the AI homepage builder.",
    config: { type: "cloud", networking: { type: "unrestricted" } },
  });
  await store.set(STORAGE_KEYS.environmentId, env.id);
  return env.id;
}

export async function ensureAgent(
  client: Anthropic,
  store: KVStore,
  model: HomepageModel = DEFAULT_MODEL,
): Promise<string> {
  const key = agentIdKey(model);
  const cached = await store.get<string>(key);
  if (cached) {
    try {
      await client.beta.agents.retrieve(cached);
      return cached;
    } catch {
      await store.remove(key);
    }
  }

  const agent = await client.beta.agents.create({
    name: AGENT_NAME,
    model,
    description: "Builds a personalized homepage from the user's browsing history.",
    system: HOMEPAGE_SYSTEM_PROMPT,
    tools: [
      {
        type: "agent_toolset_20260401",
        // `bash` stays off. We are reading scraped HTML, not running code, and
        // page content is by definition untrusted input — leaving bash enabled
        // widens the blast radius of a prompt injection from a scraped page.
        default_config: { enabled: false },
        configs: [
          { name: "read", enabled: true },
          { name: "grep", enabled: true },
          { name: "glob", enabled: true },
          { name: "write", enabled: true },
        ],
      },
      {
        type: "custom",
        name: "getHistory",
        description:
          "Returns a ranked digest of the user's most-visited domains over a recent " +
          "window: visit counts, unique page counts, last-visit timestamps, relevance " +
          "scores, and a few sample page titles per domain. Call this first, once.",
        input_schema: GET_HISTORY_SCHEMA,
      },
      {
        type: "custom",
        name: "getPageHtml",
        description:
          "Loads URLs in the user's real, logged-in browser, sanitizes the HTML, and " +
          "mounts each page into your sandbox. Returns a mountPath and byte count per " +
          "page plus a list of failures. Use grep/read on the returned mountPath. " +
          "Prefer this over any web fetch: it sees authenticated, JavaScript-rendered " +
          "pages that an anonymous fetch cannot.",
        input_schema: GET_PAGE_HTML_SCHEMA,
      },
    ],
  });

  await store.set(key, agent.id);
  await store.set(STORAGE_KEYS.agentVersion, agent.version);
  return agent.id;
}
