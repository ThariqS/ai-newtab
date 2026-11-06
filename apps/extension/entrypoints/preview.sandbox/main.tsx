/**
 * Renders the agent's homepage component. This is a manifest sandbox page: it
 * runs in a unique opaque origin with no chrome.* APIs and no access to the
 * extension's storage, so the model-written code it evaluates can't reach the
 * API key. React ships with the extension, so rendering fetches nothing.
 *
 * The new-tab page posts the transpiled component (see lib/transpile.ts and
 * newtab/components/HomepagePreview.tsx). It is evaluated the same way
 * harness/verify-homepage.ts checks it: as CommonJS with only React available.
 */
import React, { Component, type ErrorInfo, type ReactNode } from "react";
import ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";
import { errorBox } from "../newtab/components/ui";
import type { PreviewMsg } from "@/lib/preview";

/** What the component may `require`. The prompt allows React alone; react-dom costs nothing to offer. */
const MODULES: Record<string, unknown> = { react: React, "react-dom": ReactDOM };

function evaluate(code: string): React.ElementType {
  const module = { exports: {} as Record<string, unknown> };
  const require = (name: string) => {
    if (name in MODULES) return MODULES[name];
    throw new Error(`The homepage imports "${name}", but only React is available.`);
  };
  new Function("require", "module", "exports", "React", code)(require, module, module.exports, React);
  const Homepage = module.exports.default ?? module.exports.PersonalizedHomepage;
  if (!Homepage) throw new Error("The homepage has no default-exported component.");
  return Homepage as React.ElementType;
}

function Failure({ error }: { error: unknown }) {
  return (
    <div style={{ maxWidth: 560, margin: "14vh auto", padding: 24, fontFamily: "system-ui", lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 22 }}>This homepage couldn&apos;t render</h1>
      <p style={{ color: "#555" }}>Rebuild to get a fresh one.</p>
      <pre style={{ ...errorBox, whiteSpace: "pre-wrap", padding: 12, borderRadius: 4 }}>
        {error instanceof Error ? error.message : String(error)}
      </pre>
    </div>
  );
}

class Boundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[preview] homepage threw while rendering", error, info.componentStack);
  }

  render() {
    return this.state.error ? <Failure error={this.state.error} /> : this.props.children;
  }
}

const root = createRoot(document.getElementById("root")!);
let generation = 0;

window.addEventListener("message", (event: MessageEvent<PreviewMsg>) => {
  if (event.source !== window.parent || event.data?.kind !== "render") return;
  let content: ReactNode;
  try {
    const Homepage = evaluate(event.data.code);
    content = <Homepage />;
  } catch (err) {
    console.error("[preview] homepage failed to load", err);
    content = <Failure error={err} />;
  }
  // A fresh key per render, so a new homepage isn't stuck behind the last one's error.
  root.render(<Boundary key={++generation}>{content}</Boundary>);
});
