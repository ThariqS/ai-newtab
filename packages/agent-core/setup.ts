import type Anthropic from "@anthropic-ai/sdk";
import { HOMEPAGE_SYSTEM_PROMPT } from "./prompt";
import { GET_HISTORY_SCHEMA, GET_PAGE_HTML_SCHEMA } from "./schemas";
import type { KVStore } from "./types";

/** Models offered in Settings. The first is the default. */
export const MODEL_CHOICES = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
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

/**
 * Everything an agent is created from. A cached agent keeps whatever prompt and
 * tools it was created with, so a fingerprint of this rides along in its
 * metadata; when the code changes (e.g. after pulling an update), the agent is
 * updated in place instead of silently running the old definition.
 */
function agentDefinition(model: HomepageModel) {
  return {
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
  } satisfies Anthropic.Beta.AgentCreateParams;
}

async function fingerprint(definition: object): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(definition));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function ensureAgent(
  client: Anthropic,
  store: KVStore,
  model: HomepageModel = DEFAULT_MODEL,
): Promise<string> {
  const definition = agentDefinition(model);
  const metadata = { config: await fingerprint(definition) };
  const key = agentIdKey(model);
  const cached = await store.get<string>(key);
  const existing = cached
    ? await client.beta.agents.retrieve(cached).catch(() => null)
    : null;
  if (existing) {
    // Outside the retrieve fallback on purpose: a failed update should surface,
    // not quietly orphan this agent and create a new one every build.
    if (existing.metadata?.config !== metadata.config) {
      await client.beta.agents.update(existing.id, { version: existing.version, ...definition, metadata });
    }
    return existing.id;
  }
  if (cached) await store.remove(key);

  const agent = await client.beta.agents.create({ ...definition, metadata });

  await store.set(key, agent.id);
  await store.set(STORAGE_KEYS.agentVersion, agent.version);
  return agent.id;
}
