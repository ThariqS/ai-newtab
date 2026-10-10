import { isPrivateAddress, type BrowserBridge, type ScrapedPage } from "@homepage/agent-core";
import sanitizeHtml from "sanitize-html";

type ScrapeReport = Awaited<ReturnType<BrowserBridge["getPageHtml"]>>;

/** What entrypoints/scraper.content.ts returns from inside the page. */
interface ScraperResult {
  url: string;
  title: string;
  html: string;
}

interface ScrapeOptions {
  loadDelay?: number; // Delay in ms after page load completes
  maxRetries?: number; // Maximum number of retry attempts
  retryDelay?: number; // Initial retry delay in ms
  timeout?: number; // Maximum time to wait for a page in ms
  concurrentTabs?: number; // Number of tabs to process concurrently
}

const DEFAULT_OPTIONS: Required<ScrapeOptions> = {
  loadDelay: 8000, // 8 seconds default delay after load
  maxRetries: 3,
  retryDelay: 1000, // 1 second initial retry delay
  timeout: 30000, // 30 seconds timeout
  concurrentTabs: 3, // Process up to 3 tabs at once
};

/**
 * The address the extension's own API requests connect to. A private one means a
 * proxy (or similar) sits in the path, so the address a scraped page arrives from
 * says nothing about the page's host and is not reported.
 */
let apiAddress: string | undefined;
browser.webRequest.onResponseStarted.addListener(
  (details) => {
    apiAddress = details.ip;
  },
  { urls: ["https://api.anthropic.com/*"], tabId: -1 },
);

/** Keep content and links; drop scripts, styles, attributes and empty wrappers. */
function cleanHtmlForLLM(html: string) {
  return sanitizeHtml(html, {
    allowedTags: [
      // Text content
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "a",
      "em",
      "strong",
      "b",
      "i",
      "blockquote",
      "code",
      "pre",
      // Lists
      "ul",
      "ol",
      "li",
      // Tables
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      // Media
      "img",
      "figure",
      "figcaption",
      // Structure
      "div",
      "span",
      "br",
      "hr",
    ],
    allowedAttributes: {
      a: ["href", "title"],
      img: ["src", "alt", "title", "width", "height"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    // Remove empty tags
    exclusiveFilter: (frame) => {
      return !frame.text.trim() && !frame.tag.match(/^(img|br|hr)$/);
    },
  });
}

/** Scrape in a separate unfocused window so tabs don't flash in front of the user. */
async function createScraperWindow(): Promise<number> {
  const win = await browser.windows.create({
    focused: false,
    state: "normal",
    width: 1200,
    height: 800,
  });
  if (win?.id === undefined) throw new Error("Could not open the scraper window");
  return win.id;
}

async function scrapeUrl(
  url: string,
  windowId: number,
  opts: Required<ScrapeOptions>,
  addressOf: (tabId: number) => string | undefined
): Promise<ScrapedPage | null> {
  try {
    // Create a new tab in the scraper window
    const tab = await browser.tabs.create({
      url,
      active: false,
      windowId,
    });

    // Wait for the tab to load with timeout
    const loadComplete = await waitForTabLoad(tab.id!, opts.timeout);

    if (!loadComplete) {
      console.error(`Timeout waiting for ${url} to load`);
      await browser.tabs.remove(tab.id!);
      return null;
    }

    // Additional delay for dynamic content
    await new Promise((resolve) => setTimeout(resolve, opts.loadDelay));

    // Try to extract content with retries
    let result: ScraperResult | null = null;
    let retryCount = 0;
    let currentDelay = opts.retryDelay;

    while (retryCount <= opts.maxRetries && !result) {
      try {
        // Scrolls to trigger lazy content, then returns { title, html }.
        const injectionResults = await browser.scripting.executeScript({
          target: { tabId: tab.id! },
          files: ["/content-scripts/scraper.js"],
        });

        if (
          injectionResults &&
          injectionResults[0] &&
          injectionResults[0].result
        ) {
          result = injectionResults[0].result as ScraperResult;

          // Validate result has content
          if (!result.html || result.html.trim() === "") {
            result = null;
            throw new Error("Empty content extracted");
          }
        }
      } catch (error) {
        console.warn(`Attempt ${retryCount + 1} failed for ${url}:`, error);

        if (retryCount < opts.maxRetries) {
          // Wait before retry with exponential backoff
          await new Promise((resolve) => setTimeout(resolve, currentDelay));
          currentDelay *= 2; // Exponential backoff
        }
      }

      retryCount++;
    }

    // The address of the document just extracted.
    const ip = addressOf(tab.id!);

    // Close the tab
    await browser.tabs.remove(tab.id!);

    if (result) {
      return {
        url,
        finalUrl: result.url,
        ip,
        title: result.title,
        html: cleanHtmlForLLM(result.html),
      };
    } else {
      console.error(
        `Failed to extract content from ${url} after ${opts.maxRetries} retries`
      );
      return null;
    }
  } catch (error) {
    console.error(`Failed to scrape ${url}:`, error);
    return null;
  }
}

/**
 * Load each URL in the user's real (logged-in) browser and return sanitized HTML,
 * reporting failures rather than dropping them — the model needs to know which
 * of the pages it asked for didn't come back.
 */
export async function scrapeUrls(
  urls: string[],
  options?: ScrapeOptions
): Promise<ScrapeReport> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const pages: ScrapedPage[] = [];
  const failed: ScrapeReport["failed"] = [];

  // Create a separate window for scraping
  const windowId = await createScraperWindow();

  // Before any tab loads: the address each tab's document was served from, last response wins.
  // Keyed by tab and read only for the scraper's own tabs: a windowId filter matches nothing
  // here, since these events report no windowId.
  const addresses = new Map<number, string | undefined>();
  const recordAddress = (details: { tabId: number; ip?: string }) => {
    addresses.set(details.tabId, details.ip);
  };
  const direct = apiAddress !== undefined && !isPrivateAddress(apiAddress);
  if (direct) {
    browser.webRequest.onResponseStarted.addListener(recordAddress, {
      urls: ["http://*/*", "https://*/*"],
      types: ["main_frame"],
    });
  }
  const addressOf = (tabId: number) => addresses.get(tabId);

  try {
    // Process URLs in batches
    for (let i = 0; i < urls.length; i += opts.concurrentTabs) {
      const batch = urls.slice(i, i + opts.concurrentTabs);

      const batchResults = await Promise.all(
        batch.map(async (url) => ({ url, page: await scrapeUrl(url, windowId, opts, addressOf) }))
      );

      for (const { url, page } of batchResults) {
        if (page) pages.push(page);
        else failed.push({ url, reason: "failed to load or extract within timeout" });
      }
    }
  } finally {
    browser.webRequest.onResponseStarted.removeListener(recordAddress);
    // Close the scraper window
    try {
      await browser.windows.remove(windowId);
    } catch (error) {
      console.error("Failed to close scraper window:", error);
    }
  }

  return { pages, failed };
}

async function waitForTabLoad(
  tabId: number,
  timeout: number
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const listener = (changedTabId: number, changeInfo: { status?: string }) => {
      if (changedTabId === tabId && changeInfo.status === "complete") {
        browser.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeoutId);
        resolve(true);
      }
    };

    // Set timeout
    timeoutId = setTimeout(() => {
      browser.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, timeout);

    browser.tabs.onUpdated.addListener(listener);
  });
}
