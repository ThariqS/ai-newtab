import { describe, expect, test } from "bun:test";
import { OUTPUT_ROOT, SANDBOX_LIMITS, Sandbox, formatHtmlForSandbox, globToRegExp } from "@homepage/agent-core";

describe("Sandbox", () => {
  const sb = new Sandbox();
  sb.mount("/mnt/session/uploads/pages/a_0.html", "line one\nline two\nline Three\nline four");
  sb.mount("/mnt/session/uploads/pages/b_1.html", "other\nTHREE");

  test("read numbers lines and paginates", () => {
    expect(sb.read("/mnt/session/uploads/pages/a_0.html", { limit: 2 })).toBe("1\tline one\n2\tline two\n[showing lines 1-2 of 4; call read again with offset=3 for more]");
    expect(sb.read("mnt/session/uploads/pages/a_0.html", { offset: 4 })).toBe("4\tline four");
    expect(sb.read("/mnt/session/uploads/pages/a_0.html", { offset: 9 })).toMatch(/past the end/);
  });

  test("read suggests the right file for a wrong path", () => {
    expect(() => sb.read("/pages/a_0.html")).toThrow(/Did you mean: \/mnt\/session\/uploads\/pages\/a_0.html/);
  });

  test("grep searches one file, a glob, or everything, with context", () => {
    expect(sb.grep("two", { path: "/mnt/session/uploads/pages/a_0.html" })).toBe("/mnt/session/uploads/pages/a_0.html:2:line two\n[1 match(es) in 1 file(s)]");
    expect(sb.grep("three", { ignoreCase: true })).toContain("b_1.html:2:THREE");
    expect(sb.grep("three", { ignoreCase: true, path: "**/a_*.html" })).not.toContain("b_1");
    expect(sb.grep("two", { context: 1 })).toContain("a_0.html-1-line one\n/mnt/session/uploads/pages/a_0.html:2:line two\n/mnt/session/uploads/pages/a_0.html-3-line Three");
    expect(sb.grep("nothing")).toMatch(/^No matches/);
    expect(() => sb.grep("(")).toThrow(/Invalid regular expression/);
  });

  test("grep caps matches, lines and the character budget", () => {
    const big = new Sandbox();
    big.mount("/mnt/session/uploads/big.html", Array.from({ length: 500 }, (_, i) => `x${i} ${"y".repeat(5000)}`).join("\n"));
    const out = big.grep("x", { maxMatches: 3 });
    expect(out).toContain("stopped at 3");
    expect(out).toContain("[line truncated]");
    const all = big.grep("x");
    expect(all.length).toBeLessThan(SANDBOX_LIMITS.resultMaxChars + 200);
    expect(all).toMatch(/stopped at the 60000-character budget after \/mnt\/session\/uploads\/big.html:\d+/);
  });

  test("read stops at the character budget with an exact continuation offset", () => {
    const big = new Sandbox();
    big.mount("/mnt/session/uploads/big.html", Array.from({ length: 100 }, (_, i) => `line ${i} ${"z".repeat(3000)}`).join("\n"));
    const out = big.read("/mnt/session/uploads/big.html");
    const m = out.match(/\[showing lines 1-(\d+) of 100; call read again with offset=(\d+) for more\]/);
    expect(m).not.toBeNull();
    expect(Number(m![2])).toBe(Number(m![1]) + 1);
    expect(out.length).toBeLessThan(SANDBOX_LIMITS.resultMaxChars + 200);
    expect(big.read("/mnt/session/uploads/big.html", { offset: Number(m![2]) })).toContain(`${m![2]}\tline ${Number(m![2]) - 1} `);
  });

  test("formatHtmlForSandbox turns one-line markup into one block per line", () => {
    const html = `<div><h1>Title</h1><p>One</p><p>Two <a href="/x">link</a></p><ul><li>a</li><li>b</li></ul>\n\n\n<div>tail</div></div>`;
    const lines = formatHtmlForSandbox(html).split("\n");
    expect(lines).toEqual([
      "<div>",
      "<h1>Title</h1>",
      "<p>One</p>",
      '<p>Two <a href="/x">link</a></p>',
      "<ul>",
      "<li>a</li>",
      "<li>b</li>",
      "</ul>",
      "<div>tail</div>",
      "</div>",
    ]);
  });

  test("glob matches by depth and bare name", () => {
    expect(sb.glob("**/*.html")).toHaveLength(2);
    expect(sb.glob("a_0.html")).toEqual(["/mnt/session/uploads/pages/a_0.html"]);
    expect(sb.glob("/mnt/session/uploads/pages/?_1.html")).toEqual(["/mnt/session/uploads/pages/b_1.html"]);
    expect(globToRegExp("**/*.html").test("/x/y/z.html")).toBe(true);
    expect(globToRegExp("*.html").test("/x/y.html")).toBe(false);
  });

  test("write is confined to the outputs root and round-trips through a snapshot", () => {
    expect(() => sb.write("/mnt/session/uploads/pages/a_0.html", "x")).toThrow(/Only files under/);
    expect(sb.write(`${OUTPUT_ROOT}/homepage.tsx`, "code")).toBe(`${OUTPUT_ROOT}/homepage.tsx`);
    const copy = Sandbox.fromSnapshot(sb.snapshot());
    expect(copy.outputs()).toEqual([{ path: `${OUTPUT_ROOT}/homepage.tsx`, content: "code" }]);
    expect(copy.list()).toEqual(sb.list());
  });
});
