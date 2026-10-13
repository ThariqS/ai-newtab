import { useEffect, useRef } from "react";
import { SandpackLayout, SandpackPreview, SandpackProvider } from "@codesandbox/sandpack-react";
import { skinCss, type Skin } from "@homepage/agent-core";
import type { LinkTarget } from "@/lib/storage";
import type { ResolvedTheme, ThemePreference } from "@/lib/theme";

/** Message the preview posts to this page when a link is clicked. */
const NAVIGATE_MESSAGE = "ai-homepage:navigate";
/** Message this page posts into the preview when the theme changes. */
const THEME_MESSAGE = "ai-homepage:theme";
/** Message this page posts into the preview when the look changes. */
const SKIN_MESSAGE = "ai-homepage:skin";

/** What the bootstrap needs to apply a look: the id for `html[data-skin]` and the stylesheet. */
function skinPayload(skin: Skin | null): { id: string | null; css: string } {
  return skin ? { id: skin.id, css: skinCss(skin) } : { id: null, css: "" };
}

/**
 * The preview iframe is sandboxed (no allow-top-navigation, no
 * allow-popups-to-escape-sandbox) and cross-origin, so two things are arranged
 * from its bootstrap:
 *
 * - Links: every click on an http(s) link is handed to the parent page, which
 *   opens it from the extension context (a real tab, not a sandboxed popup)
 *   according to the "Links open in" setting; modified clicks (cmd/ctrl/shift,
 *   middle button) always open a background tab.
 * - Theme: the user's preference is applied as `data-theme` / `color-scheme`
 *   on the sandbox's <html>, baked in at build time and updated over
 *   postMessage. The component contract asks the model to honour it.
 */
function indexJs(preference: ThemePreference, skin: Skin | null): string {
  return `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

function onLinkClick(event) {
  if (event.defaultPrevented) return;
  const anchor = event.target.closest && event.target.closest("a[href]");
  if (!anchor) return;
  const href = anchor.href;
  if (!/^https?:/i.test(href)) return;
  const middle = event.button === 1;
  if (event.button !== 0 && !middle) return;
  event.preventDefault();
  const background = middle || event.metaKey || event.ctrlKey || event.shiftKey;
  window.parent.postMessage({ type: ${JSON.stringify(NAVIGATE_MESSAGE)}, href, background }, "*");
}
document.addEventListener("click", onLinkClick);
document.addEventListener("auxclick", onLinkClick);

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

// A look is a stylesheet rooted at html[data-skin]; it outranks the
// component's own :root tokens and restyles its data-part elements.
function applySkin(skin) {
  const root = document.documentElement;
  let style = document.getElementById("ai-homepage-skin");
  if (!style) {
    style = document.createElement("style");
    style.id = "ai-homepage-skin";
    document.head.appendChild(style);
  }
  if (skin && skin.id) {
    root.dataset.skin = skin.id;
    style.textContent = skin.css;
  } else {
    delete root.dataset.skin;
    style.textContent = "";
  }
}
applySkin(${JSON.stringify(skinPayload(skin))});

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data) return;
  if (data.type === ${JSON.stringify(THEME_MESSAGE)}) applyTheme(data.theme);
  if (data.type === ${JSON.stringify(SKIN_MESSAGE)}) applySkin(data.skin);
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
  skin,
  linkTarget,
}: {
  code: string;
  /** The user's preference, baked into the bootstrap so the first paint is right. */
  theme: ThemePreference;
  /** What the preference resolves to right now, for Sandpack's own chrome. */
  resolvedTheme: ResolvedTheme;
  /** The look applied over the page, or null for the agent's own. */
  skin: Skin | null;
  /** Where a plain click on a link goes. */
  linkTarget: LinkTarget;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // The bootstrap is baked once; later theme and look changes go over
  // postMessage so the preview is not re-bundled (and re-mounted) on every change.
  const initialTheme = useRef(theme);
  const initialSkin = useRef(skin);

  const ownFrames = () => [...(containerRef.current?.querySelectorAll("iframe") ?? [])].map((f) => f.contentWindow);

  // Open links the preview reports, from the extension context.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; href?: unknown; background?: unknown } | null;
      if (!data || data.type !== NAVIGATE_MESSAGE || typeof data.href !== "string") return;
      // Only our own preview frame may steer this page.
      if (!ownFrames().includes(event.source as Window)) return;
      if (!/^https?:\/\//i.test(data.href)) return;
      if (data.background === true) {
        void browser.tabs.create({ url: data.href, active: false });
      } else if (linkTarget === "newTab") {
        void browser.tabs.create({ url: data.href, active: true });
      } else {
        window.location.assign(data.href);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [linkTarget]);

  useEffect(() => {
    for (const frame of ownFrames()) frame?.postMessage({ type: THEME_MESSAGE, theme }, "*");
  }, [theme]);
  useEffect(() => {
    for (const frame of ownFrames()) frame?.postMessage({ type: SKIN_MESSAGE, skin: skinPayload(skin) }, "*");
  }, [skin]);

  const files = {
    "/App.js": { code },
    "/index.js": { code: indexJs(initialTheme.current, initialSkin.current) },
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
