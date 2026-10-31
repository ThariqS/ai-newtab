/**
 * Input schemas for every tool the model can call. The caps live in the schema,
 * not just the handler, so the model can see the ceiling it is working against.
 */

export interface ToolInputSchema {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties?: boolean;
  [k: string]: unknown;
}

export const GET_HISTORY_SCHEMA: ToolInputSchema = {
  type: "object",
  properties: {
    daysToAnalyze: {
      type: "integer",
      minimum: 1,
      maximum: 90,
      description: "How many days of history to analyze. Default 14.",
    },
    maxResults: {
      type: "integer",
      minimum: 1,
      maximum: 50,
      description: "Top N domains by relevance score. Default 30.",
    },
  },
  required: [],
  additionalProperties: false,
};

export const GET_PAGE_HTML_SCHEMA: ToolInputSchema = {
  type: "object",
  properties: {
    urls: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: { type: "string" },
      description:
        "URLs to load in real browser tabs. Authenticated, JS-rendered pages work — " +
        "this is the user's own logged-in browser, not a fetch from a datacenter.",
    },
    loadDelayMs: {
      type: "integer",
      minimum: 0,
      maximum: 30000,
      description: "Extra wait after load, for lazy-rendered content. Default 8000.",
    },
  },
  required: ["urls"],
  additionalProperties: false,
};

export const GREP_SCHEMA: ToolInputSchema = {
  type: "object",
  properties: {
    pattern: { type: "string", description: "JavaScript regular expression to search for, e.g. 'href=\"https://[^\"]+' or 'class=\"titleline'." },
    path: {
      type: "string",
      description: "A mounted file path, or a glob such as '**/*.html'. Omit to search every mounted file.",
    },
    ignoreCase: { type: "boolean", description: "Case-insensitive match. Default false." },
    context: { type: "integer", minimum: 0, maximum: 10, description: "Lines of context before and after each match. Default 0." },
    maxMatches: { type: "integer", minimum: 1, maximum: 200, description: "Stop after this many matches. Default 200." },
  },
  required: ["pattern"],
  additionalProperties: false,
};

export const READ_SCHEMA: ToolInputSchema = {
  type: "object",
  properties: {
    path: { type: "string", description: "The mountPath returned by getPageHtml, verbatim." },
    offset: { type: "integer", minimum: 1, description: "1-based line to start from. Default 1." },
    limit: { type: "integer", minimum: 1, maximum: 2000, description: "Maximum lines to return. Default 400." },
  },
  required: ["path"],
  additionalProperties: false,
};

export const GLOB_SCHEMA: ToolInputSchema = {
  type: "object",
  properties: {
    pattern: { type: "string", description: "Glob such as '**/*.html' or '*ycombinator*'. '**' matches any depth." },
  },
  required: ["pattern"],
  additionalProperties: false,
};

export const WRITE_SCHEMA: ToolInputSchema = {
  type: "object",
  properties: {
    path: { type: "string", description: "Destination path. The homepage must go to /mnt/session/outputs/homepage.tsx." },
    content: { type: "string", description: "The complete file contents. Overwrites any existing file." },
  },
  required: ["path", "content"],
  additionalProperties: false,
};

export const DEFAULTS = {
  daysToAnalyze: 14,
  maxResults: 30,
  loadDelayMs: 8000,
  /** Cap on titles carried per domain in the digest. */
  sampleTitles: 5,
} as const;
