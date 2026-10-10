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

/** Loopback, private and link-local addresses, and names only a local network resolves. */
export function isPrivateHost(host: string): boolean {
  if (host.startsWith("[")) {
    const v6 = host.slice(1, -1);
    // URL serializes IPv4-mapped addresses as hex, e.g. [::ffff:7f00:1].
    const mapped = v6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mapped) {
      const [hi, lo] = [parseInt(mapped[1], 16), parseInt(mapped[2], 16)];
      return isPrivateHost(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
  }
  const v4 = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return !host.includes(".") || /\.(local|localhost|internal|lan|home\.arpa)$/.test(host);
}

/**
 * Match at domain boundaries, including subdomains for both list syntaxes.
 * Private and local-network hosts are always blocked, whatever the list says.
 */
export function isBlocked(urlOrHost: string, list: string[]): boolean {
  try {
    const host = hostname(urlOrHost);
    if (isPrivateHost(host)) return true;
    return list.some((entry) => {
      const domain = entry.replace(/^\*\./, "");
      return host === domain || host.endsWith(`.${domain}`);
    });
  } catch {
    return true;
  }
}

/** Only http(s) URLs whose host is not blocked may be loaded or read. */
export function isAllowedUrl(url: string, list: string[]): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && !isBlocked(parsed.href, list);
  } catch {
    return false;
  }
}
