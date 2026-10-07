import { describe, expect, test } from "bun:test";
import { buildHistoryDigest, slugifyUrl } from "@homepage/agent-core";
import { fixtureHistory } from "./node-bridge";

describe("buildHistoryDigest", () => {
  const sites = fixtureHistory();

  test("caps the site list at maxResults", () => {
    const digest = buildHistoryDigest(sites, { daysToAnalyze: 14, maxResults: 5 });
    expect(digest.sites).toHaveLength(5);
  });

  test("reports what the model is not seeing", () => {
    const digest = buildHistoryDigest(sites, { daysToAnalyze: 14, maxResults: 5 });
    expect(digest.totalSitesSeen).toBe(sites.length);
    expect(digest.totalSitesSeen).toBeGreaterThan(digest.sites.length);
  });

  test("ranks by relevance score descending", () => {
    const digest = buildHistoryDigest(sites, { daysToAnalyze: 14, maxResults: 10 });
    const scores = digest.sites.map((s) => s.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(digest.sites[0].domain).toBe("news.ycombinator.com");
  });

  test("drops urls[] entirely and caps sampleTitles", () => {
    const fat = [
      {
        domain: "example.com",
        totalVisits: 10,
        uniquePages: 9,
        lastVisitTime: Date.now(),
        averageVisitsPerDay: 1,
        titles: Array.from({ length: 50 }, (_, i) => `title ${i}`),
        urls: Array.from({ length: 50 }, (_, i) => `https://example.com/${i}`),
        relevanceScore: 0.5,
      },
    ];
    const digest = buildHistoryDigest(fat, { daysToAnalyze: 14, maxResults: 10 });
    expect(digest.sites[0].sampleTitles).toHaveLength(5);
    expect(JSON.stringify(digest)).not.toContain("example.com/0");
  });

  test("emits ISO dates, not epoch millis", () => {
    const digest = buildHistoryDigest(sites, { daysToAnalyze: 14, maxResults: 3 });
    for (const site of digest.sites) {
      expect(site.lastVisit).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  test("stays small enough to sit inline in a tool result", () => {
    const digest = buildHistoryDigest(sites, { daysToAnalyze: 14, maxResults: 30 });
    // ~4 chars/token: a few thousand tokens, not millions.
    expect(JSON.stringify(digest).length).toBeLessThan(40_000);
  });
});

describe("slugifyUrl", () => {
  test("strips www and non-alphanumerics", () => {
    expect(slugifyUrl("https://www.news.ycombinator.com/news")).toBe("news_ycombinator_com");
  });

  test("survives a malformed url", () => {
    expect(slugifyUrl("not a url")).toBe("not_a_url");
  });

  test("never returns an empty slug", () => {
    expect(slugifyUrl("///")).toBe("page");
  });
});
