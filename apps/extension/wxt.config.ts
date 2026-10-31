import { defineConfig } from "wxt";
import { LOCALES } from "./lib/i18n/locales";
import en from "./lib/i18n/locales/en";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    // Chrome's own translations of the name and description, generated below
    // from each catalog's manifest.* keys.
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    default_locale: "en",
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
  hooks: {
    // _locales/<code>/messages.json for every catalog, so a language is one file to add.
    "build:publicAssets": (_wxt, files) => {
      for (const locale of LOCALES) {
        const messages = {
          extName: { message: locale.messages["manifest.name"] ?? en["manifest.name"] },
          extDescription: { message: locale.messages["manifest.description"] ?? en["manifest.description"] },
        };
        files.push({ relativeDest: `_locales/${locale.code.replace("-", "_")}/messages.json`, contents: JSON.stringify(messages, null, 2) });
      }
    },
  },
});
