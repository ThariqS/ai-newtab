/**
 * Contract between the new-tab page and the preview sandbox
 * (entrypoints/preview.sandbox), which renders the agent's component.
 */

/** The sandbox page, as WXT emits it. Listed under `sandbox.pages` in the manifest. */
export const PREVIEW_PAGE = "/preview.html";

// new-tab page → sandbox
export type PreviewMsg = { kind: "render"; code: string }; // CommonJS from transpile.ts
