/** Defaults remain editable, including the sites previously excluded from history. */
export const DEFAULT_BLOCKED_SITES = [
  "localhost", "127.0.0.1", "drive.google.com", "docs.google.com",
  "sheets.google.com", "slides.google.com", "mail.google.com",
  "outlook.live.com", "outlook.office.com", "accounts.google.com",
  "login.microsoftonline.com",
];

/**
 * Parse with URL so ports, credentials and trailing dots cannot disguise a host.
 * A value that already parses as a URL keeps that reading, including the
 * `https:/host` and `https:\host` forms browsers accept; bare hosts get a scheme.
 */
function hostname(value: string): string {
  let host = "";
  try {
    host = new URL(value).hostname;
  } catch {
    // Not an absolute URL: treat it as a bare host below.
  }
  if (!host) host = new URL(`https://${value}`).hostname;
  return host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

/** Accept pasted URLs as well as hosts, and keep the stored list compact. */
export function normalizeBlockList(lines: string[]): string[] {
  const hosts = lines.flatMap((line) => {
    const value = line.trim().toLowerCase();
    if (!value || value.startsWith("#")) return [];
    const wildcard = value.startsWith("*.");
    try {
      const host = hostname(wildcard ? value.slice(2) : value);
      return host ? [`${wildcard ? "*." : ""}${host}`] : [];
    } catch {
      return [];
    }
  });
  return [...new Set(hosts)];
}

/** Match at domain boundaries, including subdomains for both list syntaxes. */
export function isBlocked(urlOrHost: string, list: string[]): boolean {
  try {
    const host = hostname(urlOrHost);
    return list.some((entry) => {
      const domain = entry.replace(/^\*\./, "");
      return host === domain || host.endsWith(`.${domain}`);
    });
  } catch {
    return true;
  }
}
