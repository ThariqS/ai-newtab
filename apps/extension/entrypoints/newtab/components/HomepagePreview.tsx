import { useEffect } from "react";
import { SandpackLayout, SandpackPreview, SandpackProvider } from "@codesandbox/sandpack-react";

/** Message the preview posts to this page when a link is clicked. */
const NAVIGATE_MESSAGE = "ai-homepage:navigate";

/**
 * The preview iframe is sandboxed without allow-top-navigation, so a link
 * inside it can only load in the iframe (where most sites refuse to be
 * framed) or, via allow-popups, in a new tab. A new-tab page should behave
 * like Chrome's own: a plain click goes there in this tab. So plain clicks are
 * handed to the parent page, which navigates; modified clicks (cmd/ctrl/shift,
 * middle button) keep the browser's new-tab behaviour through <base target>.
 */
const INDEX_JS = `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const base = document.createElement("base");
base.target = "_blank";
document.head.prepend(base);

document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.target.closest && event.target.closest("a[href]");
  if (!anchor) return;
  const href = anchor.href;
  if (!/^https?:/i.test(href)) return;
  event.preventDefault();
  window.parent.postMessage({ type: ${JSON.stringify(NAVIGATE_MESSAGE)}, href }, "*");
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);`;

const INDEX_HTML = `<!DOCTYPE html>
<html><head><title>My Personalized Homepage</title></head>
<body><div id="root"></div></body></html>`;

/**
 * Renders the agent's component in a Sandpack iframe. The code is
 * model-generated, so it runs sandboxed rather than in the extension's own page.
 */
export function HomepagePreview({ code }: { code: string }) {
  // Navigate this tab when the preview reports a plain click on a link.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; href?: unknown } | null;
      if (!data || data.type !== NAVIGATE_MESSAGE || typeof data.href !== "string") return;
      // Only our own preview frame may steer this page.
      const frames = [...document.querySelectorAll("iframe")].map((f) => f.contentWindow);
      if (!frames.includes(event.source as Window)) return;
      if (!/^https?:\/\//i.test(data.href)) return;
      window.location.assign(data.href);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const files = {
    "/App.js": { code },
    "/index.js": { code: INDEX_JS },
    "/index.html": { code: INDEX_HTML },
  };

  return (
    <SandpackProvider files={files} template="react" options={{ autorun: true }}>
      <SandpackLayout style={{ height: "100vh", width: "100vw" }}>
        {/* The page is the product: no "Open Sandbox" or refresh chrome over it. */}
        <SandpackPreview style={{ height: "100%" }} showOpenInCodeSandbox={false} showRefreshButton={false} />
      </SandpackLayout>
    </SandpackProvider>
  );
}
