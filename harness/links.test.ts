import { describe, expect, test } from "bun:test";
import { normalizeLinkUrl, normalizeScrapedLinks } from "@homepage/agent-core";

describe("link hygiene", () => {
  test("absolutizes relative hrefs against the page and maps Reddit's alternate hosts to www", () => {
    const base = "https://old.reddit.com/r/homelab/";
    expect(normalizeLinkUrl("/r/homelab/comments/abc/title/", base)).toBe("https://www.reddit.com/r/homelab/comments/abc/title/");
    expect(normalizeLinkUrl("https://old.reddit.com/user/x", base)).toBe("https://www.reddit.com/user/x");
    expect(normalizeLinkUrl("https://np.reddit.com/r/a", base)).toBe("https://www.reddit.com/r/a");
    expect(normalizeLinkUrl("https://i.reddit.com/r/a", base)).toBe("https://www.reddit.com/r/a");
    expect(normalizeLinkUrl("https://www.reddit.com/r/a", base)).toBe("https://www.reddit.com/r/a");
    expect(normalizeLinkUrl("https://reddit.com/r/a", base)).toBe("https://reddit.com/r/a");
  });

  test("leaves other sites, anchors and non-http links alone", () => {
    expect(normalizeLinkUrl("https://news.ycombinator.com/item?id=1", "https://old.reddit.com/")).toBe("https://news.ycombinator.com/item?id=1");
    expect(normalizeLinkUrl("mailto:a@b.c", "https://old.reddit.com/")).toBe("mailto:a@b.c");
    expect(normalizeLinkUrl("javascript:void(0)", "https://old.reddit.com/")).toBe("javascript:void(0)");
    expect(normalizeLinkUrl("relative/path", "https://example.org/dir/page")).toBe("https://example.org/dir/relative/path");
  });

  test("rewrites hrefs in sanitized HTML without touching the rest", () => {
    const html = '<a href="/r/homelab/comments/1/x/">t</a> <a href="#top">top</a> <img src="/img.png" alt="x"> <a href="https://old.reddit.com/u/me">me</a> <a href="https://example.org/">ex</a>';
    expect(normalizeScrapedLinks(html, "https://old.reddit.com/r/homelab/")).toBe(
      '<a href="https://www.reddit.com/r/homelab/comments/1/x/">t</a> <a href="#top">top</a> <img src="/img.png" alt="x"> <a href="https://www.reddit.com/u/me">me</a> <a href="https://example.org/">ex</a>',
    );
  });
});
