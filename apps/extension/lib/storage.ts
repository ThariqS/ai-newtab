import {
  DEFAULT_ENGINE,
  DEFAULT_MODEL,
  DEFAULT_BLOCKED_SITES,
  MODEL_CHOICES,
  STORAGE_KEYS as AGENT_KEYS,
  type EngineId,
  type HomepageModel,
  type KVStore,
  type ModelInfo,
  type SkinId,
  findSkin,
} from "@homepage/agent-core";

/**
 * Everything the extension persists, in one place. All of it lives in
 * chrome.storage.local — including the API keys and the ChatGPT tokens, which
 * anyone with access to the browser profile can read. Fine for a tool you run
 * yourself; not for one you distribute (see ARCHITECTURE.md → Privacy).
 */
export const KEYS = {
  ...AGENT_KEYS,
  homepage: "homepageData",
  systemPrompt: "systemPrompt",
  blockedSites: "blockedSites",
  /** Which engine builds: "claude" (default) or "openai". */
  engine: "engine",
  /** Claude model (see MODEL_CHOICES). */
  model: "model",
  /** Claude: "managed" (Managed Agents, standard price) or "batch" (Message Batches, half price, slower). */
  claudeApiMode: "claudeApiMode",
  /** OpenAI: "siwc" (ChatGPT plan) or "apiKey". */
  openaiAuthMode: "openaiAuthMode",
  openaiApiKey: "openaiApiKey",
  /** OpenAI model slug; null means "the first model the account lists". */
  openaiModel: "openaiModel",
  /** Cached `GET /models` result for the OpenAI credentials in use. */
  modelCatalog: "modelCatalog",
  autoRebuild: "autoRebuild",
  /** ISO timestamp of the last auto-build *attempted* (success or not). */
  lastAutoBuildAttempt: "lastAutoBuildAttempt",
  /** Throttled mirror of the live build state, for tabs that open while the worker sleeps. */
  buildSnapshot: "buildSnapshot",
  /** Colour scheme: "system" | "dark" | "light" (see lib/theme.ts). */
  theme: "theme",
  /** Look applied over the generated page without rebuilding: a SkinId, or null for the agent's own look. */
  skin: "skin",
  /** Where a plain click on a homepage link goes: "newTab" (default) or "sameTab". */
  linkTarget: "linkTarget",
} as const;

export interface Homepage {
  /** The agent's raw TSX source. */
  code: string;
  /** ISO timestamp of when it was built. */
  timestamp: string;
}

export interface Settings {
  engine: EngineId;
  /** Anthropic API key (Claude engine). */
  apiKey: string | null;
  /** Claude model. */
  model: HomepageModel;
  /** Claude: Managed Agents at standard price, or the Message Batches API at half price and with queue latency. */
  claudeApiMode: ClaudeApiMode;
  openaiAuthMode: "siwc" | "apiKey";
  openaiApiKey: string | null;
  openaiModel: string | null;
  systemPrompt: string;
  blockedSites: string[];
  /** Unset means on — auto-rebuild is opt-out. */
  autoRebuild: boolean;
  skin: SkinId | null;
  linkTarget: LinkTarget;
}

export type LinkTarget = "newTab" | "sameTab";

export type ClaudeApiMode = "managed" | "batch";

export interface ModelCatalog {
  models: ModelInfo[];
  fetchedAt: string;
}

/** The `KVStore` the engines persist their session/checkpoint state through. */
export const extensionStore: KVStore = {
  async get<T>(key: string): Promise<T | undefined> {
    const result = await browser.storage.local.get(key);
    return result[key] as T | undefined;
  },
  async set(key: string, value: unknown): Promise<void> {
    await browser.storage.local.set({ [key]: value });
  },
  async remove(key: string): Promise<void> {
    await browser.storage.local.remove(key);
  },
};

export async function loadSettings(): Promise<Settings> {
  const s = await browser.storage.local.get([
    KEYS.engine,
    KEYS.apiKey,
    KEYS.model,
    KEYS.claudeApiMode,
    KEYS.openaiAuthMode,
    KEYS.openaiApiKey,
    KEYS.openaiModel,
    KEYS.systemPrompt,
    KEYS.blockedSites,
    KEYS.autoRebuild,
    KEYS.skin,
    KEYS.linkTarget,
  ]);
  const model = s[KEYS.model] as string | undefined;
  return {
    engine: s[KEYS.engine] === "openai" ? "openai" : DEFAULT_ENGINE,
    apiKey: (s[KEYS.apiKey] as string | undefined) ?? null,
    // Fall back if a stored model is no longer offered.
    model: MODEL_CHOICES.find((m) => m.id === model)?.id ?? DEFAULT_MODEL,
    claudeApiMode: s[KEYS.claudeApiMode] === "batch" ? "batch" : "managed",
    openaiAuthMode: s[KEYS.openaiAuthMode] === "apiKey" ? "apiKey" : "siwc",
    openaiApiKey: (s[KEYS.openaiApiKey] as string | undefined) ?? null,
    openaiModel: (s[KEYS.openaiModel] as string | undefined) ?? null,
    systemPrompt: (s[KEYS.systemPrompt] as string | undefined) ?? "",
    blockedSites: (s[KEYS.blockedSites] as string[] | undefined) ?? [...DEFAULT_BLOCKED_SITES],
    autoRebuild: s[KEYS.autoRebuild] !== false,
    skin: findSkin(s[KEYS.skin] as string | undefined)?.id ?? null,
    linkTarget: s[KEYS.linkTarget] === "sameTab" ? "sameTab" : "newTab",
  };
}

export async function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  await browser.storage.local.set({ [KEYS[key]]: value });
}

export async function loadHomepage(): Promise<Homepage | undefined> {
  return extensionStore.get<Homepage>(KEYS.homepage);
}

export async function saveHomepage(code: string): Promise<void> {
  const homepage: Homepage = { code, timestamp: new Date().toISOString() };
  await extensionStore.set(KEYS.homepage, homepage);
}

export async function loadModelCatalog(): Promise<ModelCatalog | undefined> {
  return extensionStore.get<ModelCatalog>(KEYS.modelCatalog);
}

export async function saveModelCatalog(models: ModelInfo[]): Promise<void> {
  await extensionStore.set(KEYS.modelCatalog, { models, fetchedAt: new Date().toISOString() } satisfies ModelCatalog);
}

/**
 * The OpenAI slug to build with: the chosen model if the account still lists
 * it, otherwise the first listed model, otherwise the chosen/fallback slug as-is.
 */
export function resolveOpenAIModel(chosen: string | null, catalog: ModelCatalog | undefined, fallback: string): string {
  const listed = catalog?.models ?? [];
  if (chosen && (listed.length === 0 || listed.some((m) => m.slug === chosen))) return chosen;
  return listed[0]?.slug ?? chosen ?? fallback;
}
