import type { BrowserBridge } from "@homepage/agent-core";
import { getHistorySites } from "./history";
import { scrapeUrls } from "./scraper";

/**
 * The two capabilities only a real browser has, implemented over chrome.history
 * and chrome.tabs. Runs in the service worker, in-process with the agent loop.
 */
export const browserBridge: BrowserBridge = {
  getHistory: ({ daysToAnalyze, maxResults }) => getHistorySites(daysToAnalyze, maxResults),
  getPageHtml: ({ urls, loadDelayMs }) => scrapeUrls(urls, { loadDelay: loadDelayMs }),
};
