/**
 * Protocol between the new-tab page(s) and the service worker.
 *
 * The worker owns exactly one build at a time and is the single source of truth
 * for its state (see build-manager.ts). It also owns the ChatGPT sign-in and
 * every bearer token. Tabs are thin, disposable views: they connect on
 * AGENT_PORT, receive a snapshot, then stream deltas.
 */
import type { EngineId, ModelInfo, RunPhase } from "@homepage/agent-core";

export const AGENT_PORT = "homepage-agent";

/** Live build state. The worker holds the canonical copy; tabs reduce into a mirror. */
export interface BuildState {
  running: boolean;
  phase: RunPhase | null;
  /** High-water index into BUILD_STEPS — only advances, so interleaved phases don't rewind the stepper. */
  stepIndex: number;
  detail: string;
  narration: string;
  logs: string[];
  error: string | null;
}

export const INITIAL_BUILD_STATE: BuildState = {
  running: false,
  phase: null,
  stepIndex: 0,
  detail: "",
  narration: "",
  logs: [],
  error: null,
};

/** What the page needs to know about credentials. Keys and tokens never cross the port. */
export interface AuthState {
  engine: EngineId;
  /** Whether the chosen engine can build right now. */
  ready: boolean;
  /** Claude engine: an Anthropic API key is saved. */
  claudeReady: boolean;
  openai: {
    mode: "siwc" | "apiKey";
    apiKeySaved: boolean;
    /** Sign in with ChatGPT state. */
    signedIn: boolean;
    email: string | null;
    /** Whether the granted scopes allow inference billed to the ChatGPT plan. */
    planUsage: boolean;
    /** A sign-in attempt is waiting for the browser callback. */
    pending: boolean;
    error: string | null;
  };
}

export const INITIAL_AUTH_STATE: AuthState = {
  engine: "claude",
  ready: false,
  claudeReady: false,
  openai: { mode: "siwc", apiKeySaved: false, signedIn: false, email: null, planUsage: false, pending: false, error: null },
};

/** How many recent log lines are kept (and shown). */
export const LOG_RETENTION = 40;

// page → worker
export type PageMsg =
  | { kind: "subscribe" } //                    → replies with a snapshot and the auth state
  | { kind: "refreshAuth" } //                  → replies with the auth state (after the page saved a key or switched engine)
  | { kind: "startBuild"; resume?: boolean } // no-op if one is already running
  | { kind: "cancel" }
  | { kind: "signIn"; newAccount?: boolean; promptConsent?: boolean } // Sign in with ChatGPT
  | { kind: "cancelSignIn" }
  | { kind: "signOut"; forget?: boolean }
  | { kind: "listModels"; refresh?: boolean }; // OpenAI engine → replies with `models`

// worker → page (broadcast to every connected tab, except `models`, which answers its requester)
export type BuildMsg =
  | { kind: "snapshot"; state: BuildState }
  | { kind: "phase"; phase: RunPhase; stepIndex: number; detail: string }
  | { kind: "text"; chunk: string } // narration delta
  | { kind: "log"; line: string }
  | { kind: "done"; code: string } // homepage saved; carries the raw TSX
  | { kind: "error"; message: string }
  | { kind: "auth"; state: AuthState }
  | { kind: "models"; models: ModelInfo[]; error: string | null };

/**
 * The five stages a person cares about. The agent emits finer-grained phases
 * that interleave (thinking ↔ analyzing fire repeatedly); each maps to a step
 * here. `thinking` and `error` deliberately map to none, so they never move the
 * stepper.
 */
export const BUILD_STEPS: { label: string; phases: RunPhase[] }[] = [
  { label: "Preparing agent", phases: ["setup", "session-create"] },
  { label: "Reading your history", phases: ["history"] },
  { label: "Opening pages in your browser", phases: ["scraping"] },
  { label: "Analyzing pages", phases: ["analyzing"] },
  { label: "Writing your homepage", phases: ["writing", "cleanup", "done"] },
];

/** Which step a phase belongs to, or `undefined` if it shouldn't move the stepper. */
export function stepForPhase(phase: RunPhase): number | undefined {
  const i = BUILD_STEPS.findIndex((step) => step.phases.includes(phase));
  return i === -1 ? undefined : i;
}
