import { transform } from "sucrase";

/**
 * Turn the agent's TSX into JS that Sandpack's React template can run. If the
 * transform throws, fall back to the raw source — Sandpack compiles TSX too.
 */
export function toRenderable(tsx: string): string {
  try {
    return transform(tsx, { transforms: ["typescript", "imports", "jsx"] }).code.replace(`"use strict";`, "");
  } catch (err) {
    console.warn("[transpile] sucrase failed, using raw source", err);
    return tsx;
  }
}
