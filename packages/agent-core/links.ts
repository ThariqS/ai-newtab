/**
 * Link hygiene applied to every scraped page before the model sees it:
 * relative hrefs are absolutized against the page's final URL, and Reddit's
 * alternate hosts (old., new., np., i., m.) are rewritten to www.reddit.com,
 * so a page read through old.reddit.com (simpler HTML) still links the
 * reader to the site they actually use.
 */

const REDDIT_ALT_HOST = /^(?:old|new|np|i|m)\.reddit\.com$/i;

/** The public form of a single URL, or the input when it is not an http(s) URL. */
export function normalizeLinkUrl(href: string, base: string): string {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return href;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return href;
  if (REDDIT_ALT_HOST.test(url.hostname)) url.hostname = "www.reddit.com";
  return url.href;
}

/** Rewrite every `href="…"` in sanitized HTML. Other attributes are untouched. */
export function normalizeScrapedLinks(html: string, base: string): string {
  return html.replace(/href="([^"]*)"/g, (match, href: string) => {
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith("#")) return match;
    const next = normalizeLinkUrl(trimmed, base);
    return next === trimmed ? match : `href="${next.replace(/"/g, "&quot;")}"`;
  });
}
