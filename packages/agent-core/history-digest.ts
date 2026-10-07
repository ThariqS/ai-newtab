import { DEFAULTS } from "./schemas";
import type { GetHistoryResult, RawSiteMetadata, SiteDigest } from "./types";

/**
 * Collapse raw history into something that fits in a context window.
 *
 * Raw history can carry thousands of domains with uncapped `titles[]`/`urls[]` —
 * millions of tokens. It goes back to the model inline as a tool result, so it
 * is ranked, capped and stripped of URLs here, where that costs nothing.
 */
export function buildHistoryDigest(
  sites: RawSiteMetadata[],
  opts: { daysToAnalyze: number; maxResults: number; totalSitesSeen?: number },
): GetHistoryResult {
  const ranked = [...sites].sort((a, b) => b.relevanceScore - a.relevanceScore);
  const capped = ranked.slice(0, opts.maxResults);

  const digest: SiteDigest[] = capped.map((site) => ({
    domain: site.domain,
    visits: site.totalVisits,
    pages: site.uniquePages,
    lastVisit: new Date(site.lastVisitTime).toISOString(),
    score: Number(site.relevanceScore.toFixed(3)),
    sampleTitles: site.titles.slice(0, DEFAULTS.sampleTitles),
  }));

  return {
    windowDays: opts.daysToAnalyze,
    // Tell the model what was truncated. Hand it 30 of 3,400 domains without
    // saying so and it reasons as though it has seen everything.
    totalSitesSeen: opts.totalSitesSeen ?? sites.length,
    sites: digest,
  };
}

/** Filename-safe slug for a URL, used to build a readable mount path. */
export function slugifyUrl(url: string): string {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    // fall through — a malformed URL still gets a stable slug
  }
  const slug = host.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  return slug || "page";
}
