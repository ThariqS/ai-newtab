/**
 * The tools the model sees. Two run in the host (they need a real browser),
 * four run on the in-memory sandbox. All of them are plain function tools; how
 * they are delivered to the API is a separate choice (see `ToolDelivery`),
 * because the ChatGPT-plan route wants function tools grouped in a namespace or
 * supplied through an `additional_tools` input item.
 */
import type { FunctionToolDef, InputItem, ToolDef } from "./client";
import {
  GET_HISTORY_SCHEMA,
  GET_PAGE_HTML_SCHEMA,
  GLOB_SCHEMA,
  GREP_SCHEMA,
  READ_SCHEMA,
  WRITE_SCHEMA,
} from "../schemas";

export const TOOL_NAMESPACE = "homepage";

export const TOOL_NAMES = ["getHistory", "getPageHtml", "grep", "read", "glob", "write"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const FUNCTION_TOOLS: FunctionToolDef[] = [
  {
    type: "function",
    name: "getHistory",
    description:
      "Returns a ranked digest of the user's most-visited domains over a recent " +
      "window: visit counts, unique page counts, last-visit timestamps, relevance " +
      "scores, and a few sample page titles per domain. Call this first, once.",
    parameters: GET_HISTORY_SCHEMA,
    strict: false,
  },
  {
    type: "function",
    name: "getPageHtml",
    description:
      "Loads URLs in the user's real, logged-in browser, sanitizes the HTML, and " +
      "mounts each page as a file you can grep and read. Returns a mountPath and " +
      "byte count per page plus a list of failures. Prefer this over any web " +
      "fetch: it sees authenticated, JavaScript-rendered pages that an anonymous " +
      "fetch cannot.",
    parameters: GET_PAGE_HTML_SCHEMA,
    strict: false,
  },
  {
    type: "function",
    name: "grep",
    description:
      "Regex search over mounted pages. Returns path:line:text, capped. Use it to " +
      "find headlines, links and the interesting region of a large page before reading.",
    parameters: GREP_SCHEMA,
    strict: false,
  },
  {
    type: "function",
    name: "read",
    description:
      "Read a mounted page with line numbers (like cat -n). Large pages: grep first, " +
      "then read the matching range with offset/limit.",
    parameters: READ_SCHEMA,
    strict: false,
  },
  {
    type: "function",
    name: "glob",
    description: "List mounted file paths matching a glob pattern.",
    parameters: GLOB_SCHEMA,
    strict: false,
  },
  {
    type: "function",
    name: "write",
    description:
      "Write a file under /mnt/session/outputs/. This is the only way to deliver the " +
      "finished homepage: write the complete React component to /mnt/session/outputs/homepage.tsx.",
    parameters: WRITE_SCHEMA,
    strict: false,
  },
];

/**
 * How tools reach the API:
 * - `namespace`: one `type: "namespace"` tool wrapping the functions (the
 *   documented default for ChatGPT plan usage);
 * - `additional_tools`: a developer `additional_tools` input item;
 * - `flat`: plain function tools in `tools` (the general API's shape).
 */
export type ToolDelivery = "namespace" | "additional_tools" | "flat";

export const TOOL_DELIVERY_ORDER: ToolDelivery[] = ["namespace", "additional_tools", "flat"];

const NAMESPACE_TOOL: ToolDef = {
  type: "namespace",
  name: TOOL_NAMESPACE,
  description:
    "Tools for building the homepage: read the user's browsing history, load pages in " +
    "their browser, grep/read/glob the mounted pages, and write the finished component.",
  tools: FUNCTION_TOOLS,
};

export function toolsForRequest(delivery: ToolDelivery): { tools?: ToolDef[]; inputPrefix: InputItem[] } {
  switch (delivery) {
    case "namespace":
      return { tools: [NAMESPACE_TOOL], inputPrefix: [] };
    case "additional_tools":
      return { inputPrefix: [{ type: "additional_tools", role: "developer", tools: FUNCTION_TOOLS }] };
    case "flat":
      return { tools: FUNCTION_TOOLS, inputPrefix: [] };
  }
}

/** Strip a namespace prefix the model may have attached (`homepage.grep` → `grep`). */
export function bareToolName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? name : name.slice(dot + 1);
}

export function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}
