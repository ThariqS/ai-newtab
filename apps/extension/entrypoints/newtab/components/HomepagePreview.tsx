import { useEffect, useRef } from "react";
import { SandpackLayout, SandpackPreview, SandpackProvider } from "@codesandbox/sandpack-react";
import type { ResolvedTheme, ThemePreference } from "@/lib/theme";

/** Message this page posts into the preview when the theme changes. */
const THEME_MESSAGE = "ai-homepage:theme";

/**
 * The preview is a cross-origin iframe, so the page's `data-theme` does not
 * reach it. The bootstrap applies the theme it was built with, then listens
 * for updates: `data-theme` on the sandbox's <html> ("dark" / "light", or
 * absent to follow the system) and `color-scheme` for form controls. The
 * component contract asks the model to honour that attribute.
 */
function indexJs(preference: ThemePreference): string {
  return `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

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
  // The bootstrap is baked once per code; later theme changes go over postMessage
  // so the preview is not re-bundled (and re-mounted) on every toggle.
  const initialTheme = useRef(theme);

  useEffect(() => {
    const frames = containerRef.current?.querySelectorAll("iframe") ?? [];
    for (const frame of frames) frame.contentWindow?.postMessage({ type: THEME_MESSAGE, theme }, "*");
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
          <SandpackPreview style={{ height: "100%" }} />
        </SandpackLayout>
      </SandpackProvider>
    </div>
  );
}
