import { transform } from "sucrase";

/**
 * Turn the agent's TSX into CommonJS the preview sandbox can evaluate. If the
 * transform throws, return a module that rethrows it, so the preview shows why.
 */
export function toRenderable(tsx: string): string {
  try {
    return transform(tsx, { transforms: ["typescript", "imports", "jsx"] }).code.replace(`"use strict";`, "");
  } catch (err) {
    console.warn("[transpile] sucrase failed", err);
    const message = `Couldn't compile the homepage: ${err instanceof Error ? err.message : String(err)}`;
    return `throw new Error(${JSON.stringify(message)});`;
  }
}
