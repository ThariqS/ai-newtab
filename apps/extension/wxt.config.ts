import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "AI Homepage",
    description: "A new-tab page an agent rebuilds daily from what you've actually been browsing.",
    permissions: [
      "history", //       getHistory tool
      "tabs", //          getPageHtml: open pages and watch them load
      "scripting", //     getPageHtml: inject the scraper into loaded pages
      "webRequest", //    getPageHtml: the address each scraped page was served from (observe only)
      "storage", //       API key, settings, the built homepage
      "alarms", //        heartbeat: scheduled rebuilds + reattach after a worker kill
      "notifications", // surface a failed headless rebuild when no tab is open
    ],
    // Needed to scrape arbitrary pages; also exempts api.anthropic.com from CORS.
    host_permissions: ["<all_urls>"],
    content_security_policy: {
      // The preview sandbox (entrypoints/preview.sandbox) evaluates the homepage, so it
      // needs 'unsafe-eval'. No allow-same-origin: its origin stays opaque. Links leave
      // the sandbox: in this tab on a click, or in an ordinary new tab.
      sandbox:
        "sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation; script-src 'self' 'unsafe-eval'; child-src 'self';",
    },
  },
});
