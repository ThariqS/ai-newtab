import type { RawSiteMetadata } from "@homepage/agent-core";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Domains seen fewer times than this are noise, not interests. */
const MIN_VISITS = 2;

/**
 * Read chrome.history, group it by domain, rank by relevance, and return
 * all domains so agent-core can exclude blocked sites before counting and
 * narrowing for the context window in `buildHistoryDigest`.
 */
export async function getHistorySites(
  daysToAnalyze: number,
  _maxResults: number,
): Promise<{ sites: RawSiteMetadata[]; totalSitesSeen: number }> {
  const items = await browser.history.search({
    text: "",
    startTime: Date.now() - daysToAnalyze * DAY_MS,
    maxResults: 10_000,
  });

  const ranked = rank(groupByDomain(items, daysToAnalyze), daysToAnalyze);
  return {
    sites: ranked,
    totalSitesSeen: ranked.length,
  };
}

function groupByDomain(
  items: { url?: string; title?: string; lastVisitTime?: number; visitCount?: number }[],
  days: number,
): RawSiteMetadata[] {
  const byDomain = new Map<string, RawSiteMetadata>();

  for (const item of items) {
    if (!item.url) continue;
    let url: URL;
    try {
      url = new URL(item.url);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue; // chrome://, file://, etc.

    const domain = url.hostname.replace(/^www\./, "");
    let site = byDomain.get(domain);
    if (!site) {
      site = {
        domain,
        totalVisits: 0,
        uniquePages: 0,
        lastVisitTime: 0,
        averageVisitsPerDay: 0,
        titles: [],
        urls: [],
        relevanceScore: 0,
      };
      byDomain.set(domain, site);
    }

    site.totalVisits += item.visitCount || 1;
    if (!site.urls.includes(item.url)) {
      site.urls.push(item.url);
      site.uniquePages++;
      if (item.title && !site.titles.includes(item.title)) site.titles.push(item.title);
    }
    if (item.lastVisitTime && item.lastVisitTime > site.lastVisitTime) {
      site.lastVisitTime = item.lastVisitTime;
    }
  }

  for (const site of byDomain.values()) site.averageVisitsPerDay = site.totalVisits / days;
  return [...byDomain.values()];
}

/**
 * Relevance = frequency (40%) + recency (30%) + page diversity (20%) +
 * consistency (10%), each normalized to 0–1.
 */
function rank(sites: RawSiteMetadata[], days: number): RawSiteMetadata[] {
  const now = Date.now();
  for (const site of sites) {
    const daysSinceLastVisit = (now - site.lastVisitTime) / DAY_MS;
    site.relevanceScore =
      Math.min(site.totalVisits / 50, 1) * 0.4 +
      Math.max(0, 1 - daysSinceLastVisit / days) * 0.3 +
      Math.min(site.uniquePages / 10, 1) * 0.2 +
      Math.min(site.averageVisitsPerDay / 5, 1) * 0.1;
  }
  return sites
    .filter((s) => s.totalVisits >= MIN_VISITS)
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}
