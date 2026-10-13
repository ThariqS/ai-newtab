import { useEffect, useRef } from "react";
import { SandpackLayout, SandpackPreview, SandpackProvider } from "@codesandbox/sandpack-react";
import type { ResolvedTheme, ThemePreference } from "@/lib/theme";

/** Message the preview posts to this page when a link is clicked. */
const NAVIGATE_MESSAGE = "ai-homepage:navigate";
/** Message this page posts into the preview when the theme changes. */
const THEME_MESSAGE = "ai-homepage:theme";

/**
 * The preview iframe is sandboxed without allow-top-navigation and is
 * cross-origin, so two things are arranged from its bootstrap:
 *
 * - Links: a plain click is handed to the parent page, which navigates this
 *   tab (like Chrome's own new-tab page); modified clicks (cmd/ctrl/shift,
 *   middle button) keep the browser's new-tab behaviour through <base target>.
 * - Theme: the user's preference is applied as `data-theme` / `color-scheme`
 *   on the sandbox's <html>, baked in at build time and updated over
 *   postMessage. The component contract asks the model to honour it.
 */
function indexJs(preference: ThemePreference): string {
  return `import React from "react";
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

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "dark" || theme === "light") {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  } else {
    delete root.dataset.theme;
    root.style.colorScheme = "";
  }
}
applyTheme(${JSON.stringify(preference)});
window.addEventListener("message", (event) => {
  const data = event.data;
  if (data && data.type === ${JSON.stringify(THEME_MESSAGE)}) applyTheme(data.theme);
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);`;
}

const INDEX_HTML = `<!DOCTYPE html>
<html><head><title>My Personalized Homepage</title></head>
<body><div id="root"></div></body></html>`;

/**
 * Renders the agent's component in a Sandpack iframe. The code is
 * model-generated, so it runs sandboxed rather than in the extension's own page.
 */
export function HomepagePreview({
  code,
  theme,
  resolvedTheme,
}: {
  code: string;
  /** The user's preference, baked into the bootstrap so the first paint is right. */
  theme: ThemePreference;
  /** What the preference resolves to right now, for Sandpack's own chrome. */
  resolvedTheme: ResolvedTheme;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // The bootstrap is baked once; later theme changes go over postMessage so
  // the preview is not re-bundled (and re-mounted) on every toggle.
  const initialTheme = useRef(theme);

  const ownFrames = () => [...(containerRef.current?.querySelectorAll("iframe") ?? [])].map((f) => f.contentWindow);

  // Navigate this tab when the preview reports a plain click on a link.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; href?: unknown } | null;
      if (!data || data.type !== NAVIGATE_MESSAGE || typeof data.href !== "string") return;
      // Only our own preview frame may steer this page.
      if (!ownFrames().includes(event.source as Window)) return;
      if (!/^https?:\/\//i.test(data.href)) return;
      window.location.assign(data.href);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    for (const frame of ownFrames()) frame?.postMessage({ type: THEME_MESSAGE, theme }, "*");
  }, [theme]);

  const files = {
    "/App.js": { code },
    "/index.js": { code: indexJs(initialTheme.current) },
    "/index.html": { code: INDEX_HTML },
  };

  return (
    <div ref={containerRef} style={{ height: "100%" }}>
      <SandpackProvider files={files} template="react" theme={resolvedTheme} options={{ autorun: true }}>
        <SandpackLayout style={{ height: "100vh", width: "100vw", background: "var(--bg)", border: "none" }}>
          {/* The page is the product: no "Open Sandbox" or refresh chrome over it. */}
          <SandpackPreview style={{ height: "100%" }} showOpenInCodeSandbox={false} showRefreshButton={false} />
        </SandpackLayout>
      </SandpackProvider>
    </div>
  );
}
