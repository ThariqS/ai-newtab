import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "AI Homepage",
    description:
      "A new-tab page an agent rebuilds daily from what you've actually been browsing.",
    permissions: [
      "history", //          getHistory tool
      "tabs", //             getPageHtml: open pages and watch them load; sign-in: open the ChatGPT page
      "webNavigation", //    sign-in: observe the redirect to the 127.0.0.1 callback before it is requested
      "scripting", //        getPageHtml: inject the scraper into loaded pages
      "webRequest", //       getPageHtml: the address each scraped page was served from (observe only)
      "storage", //          tokens, settings, the built homepage, the build checkpoint
      "unlimitedStorage", // the checkpoint holds every scraped page while a build runs
      "alarms", //           heartbeat: scheduled rebuilds + resume after a worker kill
      "notifications", //    surface a failed headless rebuild when no tab is open
    ],
    // Needed to scrape arbitrary pages; also exempts the Anthropic and OpenAI APIs from CORS.
    host_permissions: ["<all_urls>"],
  },
});
