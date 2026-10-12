/**
 * An in-memory stand-in for the session sandbox the Managed Agents runtime
 * used to provide. Scraped pages are stored as "files" and the model works on
 * them with grep / read / glob, then delivers the homepage with write.
 *
 * Everything here is plain TypeScript over strings: no shell, no real
 * filesystem. Page content is untrusted input, so there is deliberately nothing
 * executable in this sandbox.
 */

/** Files mount here, mirroring the layout the prompt describes. */
export const UPLOAD_ROOT = "/mnt/session/uploads";
export const OUTPUT_ROOT = "/mnt/session/outputs";

/** Caps that keep a single tool result inside a sensible token budget. */
export const SANDBOX_LIMITS = {
  /** Lines returned by one `read` call when no limit is given. */
  readDefaultLines: 400,
  /** Hard ceiling on lines per `read`, whatever the model asks for. */
  readMaxLines: 2_000,
  /** Characters per returned line before truncation. */
  lineMaxChars: 4_000,
  /** Characters per tool result. `read` and `grep` stop at this budget and say where they stopped. */
  resultMaxChars: 60_000,
  /** Matches returned by one `grep` call. */
  grepMaxMatches: 200,
  /** Context lines before/after a grep match, upper bound. */
  grepMaxContext: 10,
} as const;

/**
 * Sanitized HTML often arrives as a handful of enormous lines (minified
 * markup, single-line body). Line-oriented grep/read are useless on that, so
 * pages are re-flowed at mount time: one block-level element per line, blank
 * lines dropped. Inline formatting and attributes are untouched.
 */
export function formatHtmlForSandbox(html: string): string {
  return html
    .replace(/\r\n?/g, "\n")
    // Break after block closers and self-closing separators…
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|td|th|thead|tbody|table|blockquote|pre|figure|figcaption|article|section|header|footer|nav|aside|main)>/gi, "$&\n")
    .replace(/<(br|hr)\s*\/?>/gi, "$&\n")
    // …and before block openers, so a long run of siblings also splits.
    .replace(/<(p|div|li|ul|ol|h[1-6]|tr|table|blockquote|pre|figure|article|section|header|footer|nav|aside|main)(\s|>)/gi, "\n$&")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim() !== "")
    .join("\n")
    .trim();
}

export interface SandboxFile {
  path: string;
  content: string;
}

/** Serializable form, so a build can be checkpointed and resumed by the host. */
export interface SandboxSnapshot {
  files: SandboxFile[];
}

function normalizePath(path: string): string {
  let p = path.trim();
  if (!p.startsWith("/")) p = `/${p}`;
  // Collapse duplicate slashes and resolve "." / ".." segments.
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return `/${out.join("/")}`;
}

/** Convert a glob (`*`, `**`, `?`) into an anchored RegExp. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**/` matches zero or more directories; bare `**` matches anything.
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function truncateLine(line: string): string {
  return line.length > SANDBOX_LIMITS.lineMaxChars
    ? `${line.slice(0, SANDBOX_LIMITS.lineMaxChars)}… [line truncated]`
    : line;
}

export class Sandbox {
  private readonly files = new Map<string, string>();

  static fromSnapshot(snapshot: SandboxSnapshot | undefined): Sandbox {
    const sandbox = new Sandbox();
    for (const file of snapshot?.files ?? []) sandbox.files.set(normalizePath(file.path), file.content);
    return sandbox;
  }

  snapshot(): SandboxSnapshot {
    return { files: [...this.files].map(([path, content]) => ({ path, content })) };
  }

  /** Mount content at a path; returns the resolved path to report to the model. */
  mount(path: string, content: string): string {
    const resolved = normalizePath(path);
    this.files.set(resolved, content);
    return resolved;
  }

  has(path: string): boolean {
    return this.files.has(normalizePath(path));
  }

  get(path: string): string | undefined {
    return this.files.get(normalizePath(path));
  }

  list(): string[] {
    return [...this.files.keys()].sort();
  }

  /** Paths matching a glob, with `**` for any depth. A bare filename matches anywhere. */
  glob(pattern: string): string[] {
    const raw = pattern.trim() || "**";
    const anchored = raw.startsWith("/") ? raw : `**/${raw}`;
    const re = globToRegExp(anchored);
    return this.list().filter((p) => re.test(p));
  }

  /**
   * Return numbered lines like `cat -n`, 1-based `offset`, optional `limit`.
   * Large pages are meant to be grepped first; this call enforces a ceiling.
   */
  read(path: string, opts: { offset?: number; limit?: number } = {}): string {
    const resolved = normalizePath(path);
    const content = this.files.get(resolved);
    if (content === undefined) {
      const near = this.glob(`**/${resolved.split("/").pop() ?? ""}`);
      throw new Error(
        `No such file: ${resolved}.` +
          (near.length ? ` Did you mean: ${near.join(", ")}?` : ` Available files: ${this.list().join(", ") || "(none)"}`),
      );
    }
    const lines = content.split("\n");
    const start = Math.max(1, Math.floor(opts.offset ?? 1));
    const limit = Math.min(
      SANDBOX_LIMITS.readMaxLines,
      Math.max(1, Math.floor(opts.limit ?? SANDBOX_LIMITS.readDefaultLines)),
    );
    if (start > lines.length) {
      return `[${resolved} has ${lines.length} lines; offset ${start} is past the end]`;
    }
    // Stop at the line limit or the character budget, whichever comes first,
    // so the "continue from" offset is always exact.
    const width = String(Math.min(lines.length, start - 1 + limit)).length;
    const out: string[] = [];
    let used = 0;
    let end = start - 1;
    for (let i = start - 1; i < lines.length && i < start - 1 + limit; i++) {
      const rendered = `${String(i + 1).padStart(width)}\t${truncateLine(lines[i])}`;
      if (out.length && used + rendered.length > SANDBOX_LIMITS.resultMaxChars) break;
      out.push(rendered);
      used += rendered.length + 1;
      end = i + 1;
    }
    const tail =
      end < lines.length
        ? `\n[showing lines ${start}-${end} of ${lines.length}; call read again with offset=${end + 1} for more]`
        : "";
    return out.join("\n") + tail;
  }

  /**
   * Regex search across one file, a glob, or everything. Output is
   * `path:line:text`, with optional context lines marked `path-line-text`.
   */
  grep(
    pattern: string,
    opts: { path?: string; ignoreCase?: boolean; context?: number; maxMatches?: number } = {},
  ): string {
    let re: RegExp;
    try {
      re = new RegExp(pattern, opts.ignoreCase ? "i" : "");
    } catch (err) {
      throw new Error(`Invalid regular expression ${JSON.stringify(pattern)}: ${String(err)}`);
    }
    const targets = opts.path
      ? this.files.has(normalizePath(opts.path))
        ? [normalizePath(opts.path)]
        : this.glob(opts.path)
      : this.list();
    if (targets.length === 0) {
      throw new Error(`No files match ${JSON.stringify(opts.path ?? "**")}. Available: ${this.list().join(", ") || "(none)"}`);
    }
    const context = Math.min(SANDBOX_LIMITS.grepMaxContext, Math.max(0, Math.floor(opts.context ?? 0)));
    const maxMatches = Math.min(
      SANDBOX_LIMITS.grepMaxMatches,
      Math.max(1, Math.floor(opts.maxMatches ?? SANDBOX_LIMITS.grepMaxMatches)),
    );

    const out: string[] = [];
    let used = 0;
    let matches = 0;
    let stopped: string | null = null;
    const push = (line: string): boolean => {
      if (out.length && used + line.length > SANDBOX_LIMITS.resultMaxChars) return false;
      out.push(line);
      used += line.length + 1;
      return true;
    };
    outer: for (const path of targets) {
      const lines = this.files.get(path)!.split("\n");
      let lastPrinted = -1;
      for (let i = 0; i < lines.length; i++) {
        if (!re.test(lines[i])) continue;
        if (matches >= maxMatches) {
          stopped = `stopped at ${maxMatches} matches, refine the pattern`;
          break outer;
        }
        const from = Math.max(lastPrinted + 1, i - context);
        if (context && lastPrinted >= 0 && from > lastPrinted + 1) push("--");
        for (let j = from; j < i; j++) push(`${path}-${j + 1}-${truncateLine(lines[j])}`);
        if (!push(`${path}:${i + 1}:${truncateLine(lines[i])}`)) {
          stopped = `stopped at the ${SANDBOX_LIMITS.resultMaxChars}-character budget after ${path}:${i}; narrow the path or pattern`;
          break outer;
        }
        matches++;
        const to = Math.min(lines.length - 1, i + context);
        for (let j = i + 1; j <= to; j++) push(`${path}-${j + 1}-${truncateLine(lines[j])}`);
        lastPrinted = Math.max(lastPrinted, to);
      }
    }
    if (matches === 0) return `No matches for ${JSON.stringify(pattern)} in ${targets.length} file(s).`;
    const summary = `${matches} match(es) in ${targets.length} file(s)${stopped ? `; ${stopped}` : ""}`;
    return `${out.join("\n")}\n[${summary}]`;
  }

  /** Create or overwrite a file. Only the outputs root is writable. */
  write(path: string, content: string): string {
    const resolved = normalizePath(path);
    if (!resolved.startsWith(`${OUTPUT_ROOT}/`)) {
      throw new Error(`Only files under ${OUTPUT_ROOT}/ may be written (got ${resolved}).`);
    }
    this.files.set(resolved, content);
    return resolved;
  }

  /** Files written under the outputs root, newest-looking first by name. */
  outputs(): SandboxFile[] {
    return this.list()
      .filter((p) => p.startsWith(`${OUTPUT_ROOT}/`))
      .map((path) => ({ path, content: this.files.get(path)! }));
  }
}
