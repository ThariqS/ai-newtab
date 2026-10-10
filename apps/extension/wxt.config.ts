import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: ({ browser }) => ({
    name: "AI Homepage",
    description: "A new-tab page an agent rebuilds daily from what you've actually been browsing.",
    permissions: [
      "history", //       getHistory tool
      "tabs", //          getPageHtml: open pages and watch them load
      "scripting", //     getPageHtml: inject the scraper into loaded pages
      "storage", //       API key, settings, the built homepage
      "alarms", //        heartbeat: scheduled rebuilds + reattach after a worker kill
      "notifications", // surface a failed headless rebuild when no tab is open
    ],
    // Needed to scrape arbitrary pages; also exempts api.anthropic.com from CORS.
    host_permissions: ["<all_urls>"],
    ...(browser === "firefox" && {
      browser_specific_settings: {
        gecko: {
          // Firefox needs a fixed ID to install an unsigned build permanently
          // (Developer Edition / Nightly with signing turned off).
          id: "ai-newtab@thariqs.github.io",
          // What leaves the browser: a history summary and scraped page HTML,
          // sent to the Anthropic API.
          data_collection_permissions: { required: ["browsingActivity", "websiteContent"] },
        },
      },
    }),
  }),
});
