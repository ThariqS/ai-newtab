/**
 * The engine switch. Each engine has its own orchestrator with its own
 * authentication and resume semantics; this is the one entry point hosts call.
 */
import { runHomepageBuild as runClaudeBuild, type ClaudeRunOptions } from "./claude/orchestrator";
import { STORAGE_KEYS as CLAUDE_STORAGE_KEYS } from "./claude/setup";
import { OPENAI_STORAGE_KEYS, runHomepageBuild as runOpenAIBuild, type OpenAIRunOptions } from "./openai/orchestrator";
import type { EngineId, HomepageBuildResult } from "./types";

export type RunOptions = ClaudeRunOptions | OpenAIRunOptions;

export const ENGINES: Array<{ id: EngineId; label: string }> = [
  { id: "claude", label: "Claude (Anthropic API key)" },
  { id: "openai", label: "OpenAI (ChatGPT plan or API key)" },
];

export const DEFAULT_ENGINE: EngineId = "claude";

/** Every key an engine persists through the host's KVStore. */
export const STORAGE_KEYS = { ...CLAUDE_STORAGE_KEYS, ...OPENAI_STORAGE_KEYS } as const;

export function runHomepageBuild(opts: RunOptions): Promise<HomepageBuildResult> {
  switch (opts.engine) {
    case "claude":
      return runClaudeBuild(opts);
    case "openai":
      return runOpenAIBuild(opts);
  }
}

export { runClaudeBuild, runOpenAIBuild };
export type { ClaudeRunOptions, OpenAIRunOptions };
