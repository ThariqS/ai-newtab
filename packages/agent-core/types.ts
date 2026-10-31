/**
 * Contracts shared by every host that can drive the homepage agent, whichever
 * engine runs it.
 *
 * The orchestrators are deliberately ignorant of *where* they run. The
 * extension supplies a bridge backed by `chrome.history` / `chrome.tabs`; the
 * Bun harness supplies one backed by fixtures and `fetch`. Nothing in this
 * package may import `chrome`, `browser`, or `node:*`.
 */

/** One site's worth of browsing history, narrowed to fit in a context window. */
export interface SiteDigest {
  /** A hostname, or a community inside a hub site, e.g. `reddit.com/r/homelab`. */
  domain: string;
  visits: number;
  pages: number;
  /** ISO 8601 — the model reasons about dates, not epoch milliseconds. */
  lastVisit: string;
  score: number;
  /** Capped. `urls[]` is dropped entirely. */
  sampleTitles: string[];
}

export interface GetHistoryResult {
  windowDays: number;
  /** What the model is *not* seeing. Without this it assumes the digest is exhaustive. */
  totalSitesSeen: number;
  sites: SiteDigest[];
}

/** A page whose HTML now lives in the engine's sandbox rather than in context. */
export interface PageRef {
  url: string;
  title: string;
  /**
   * The path the sandbox actually resolved. For the Claude engine, read back
   * off the `resources.add()` response — never the path we asked for, since the
   * API re-roots every file resource under `/mnt/session/uploads/`. The OpenAI
   * engine's in-memory sandbox mounts at the same root for consistency.
   */
  mountPath: string;
  /** Lets the model choose grep-first over read-whole. */
  bytes: number;
}

export interface GetPageHtmlResult {
  pages: PageRef[];
  /** Surfaced, never swallowed: partial failure is information the model needs. */
  failed: Array<{ url: string; reason: string }>;
}

/** Raw per-domain history, as a BrowserBridge returns it — before `buildHistoryDigest` narrows it. */
export interface RawSiteMetadata {
  domain: string;
  totalVisits: number;
  uniquePages: number;
  lastVisitTime: number;
  averageVisitsPerDay: number;
  titles: string[];
  urls: string[];
  relevanceScore: number;
}

export interface ScrapedPage {
  url: string;
  /** Where the page ended up after redirects, when the host can tell. */
  finalUrl?: string;
  /** The address the browser connected to for the page, when the host can tell it is not a proxy's. */
  ip?: string;
  title: string;
  html: string;
}

/**
 * The two capabilities only a real browser has. Everything else the agent needs
 * (a filesystem, grep, read, write) is supplied by the engine's sandbox.
 */
export interface BrowserBridge {
  getHistory(args: {
    daysToAnalyze: number;
    maxResults: number;
  }): Promise<{ sites: RawSiteMetadata[]; totalSitesSeen: number }>;

  getPageHtml(args: {
    urls: string[];
    loadDelayMs?: number;
  }): Promise<{ pages: ScrapedPage[]; failed: Array<{ url: string; reason: string }> }>;
}

/** Minimal persistence. `chrome.storage.local` in the extension, a JSON file in Bun. */
export interface KVStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export type RunPhase =
  | "setup"
  | "session-create"
  | "thinking"
  | "history"
  | "scraping"
  | "analyzing"
  | "writing"
  | "cleanup"
  | "done"
  | "error";

/**
 * The facts behind a phase's detail line, for an interface that words it in
 * another language. The detail string stays the English wording, for logs and
 * the CLI.
 */
export type PhaseInfo =
  | { kind: "days"; count: number }
  | { kind: "pages"; count: number }
  | { kind: "batch-submitting" }
  | { kind: "batch-waiting"; seconds: number };

export interface RunCallbacks {
  onPhase?(phase: RunPhase, detail?: string, info?: PhaseInfo): void;
  /** Streamed assistant prose, for a progress panel. */
  onText?(text: string): void;
  onLog?(line: string): void;
}

/** Which model provider runs the build. */
export type EngineId = "claude" | "openai";

export interface HomepageBuildResult {
  code: string;
  engine: EngineId;
  /** The Claude session ID, or the OpenAI engine's local build ID. */
  id: string;
  /** Where the code came from: the sandbox's output file, or a fenced block in the final message. */
  source: "output-file" | "message-fence";
  /** Model turns taken, when the engine counts them (one per Responses request). */
  turns?: number;
}

/** Options every engine takes. */
export interface CommonRunOptions {
  bridge: BrowserBridge;
  store: KVStore;
  userSystemPrompt?: string;
  /**
   * Hosts the tools must never read. A getter is re-read before every tool call,
   * so a list saved mid-build applies to the rest of that build.
   */
  blockedSites?: string[] | (() => Promise<string[]>);
  callbacks?: RunCallbacks;
  signal?: AbortSignal;
  now?: Date;
}
