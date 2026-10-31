import { describe, expect, test } from "bun:test";
import { HOMEPAGE_SYSTEM_PROMPT, LOOK_PARTS, LOOK_TOKENS, SKINS, findSkin, skinCss } from "@homepage/agent-core";

describe("skins", () => {
  test("ids are unique and resolvable", () => {
    expect(new Set(SKINS.map((s) => s.id)).size).toBe(SKINS.length);
    for (const s of SKINS) expect(findSkin(s.id)).toBe(s);
    expect(findSkin("nope")).toBeUndefined();
    expect(findSkin(null)).toBeUndefined();
  });

  test("every skin defines every token for light, system-dark and forced-dark", () => {
    for (const skin of SKINS) {
      const css = skinCss(skin);
      const root = `html[data-skin="${skin.id}"]`;
      expect(css).toContain(`${root} {`);
      expect(css).toContain(`@media (prefers-color-scheme: dark) { ${root}:not([data-theme="light"]) {`);
      expect(css).toContain(`${root}[data-theme="dark"] {`);
      for (const token of LOOK_TOKENS) {
        expect((css.match(new RegExp(`${token}:`, "g")) ?? []).length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  test("part rules are all rooted at the skin so they outrank the component", () => {
    for (const skin of SKINS) {
      const css = skinCss(skin);
      for (const line of css.split("\n")) {
        if (!line.trim()) continue;
        expect(line.startsWith(`html[data-skin="${skin.id}"]`) || line.startsWith("@media")).toBe(true);
      }
      for (const part of ["masthead", "section-label", "headline"]) expect(css).toContain(`[data-part="${part}"]`);
    }
  });

  test("the instructions ask for every token and every part", () => {
    for (const token of LOOK_TOKENS) expect(HOMEPAGE_SYSTEM_PROMPT).toContain(`\`${token}\``);
    for (const part of LOOK_PARTS) expect(HOMEPAGE_SYSTEM_PROMPT).toContain(`\`${part}\``);
    expect(HOMEPAGE_SYSTEM_PROMPT).toContain("never hardcode a font-family or a colour");
  });

  test("no skin label or description names a real newspaper", () => {
    const text = SKINS.map((s) => `${s.label} ${s.description}`).join(" ").toLowerCase();
    for (const name of ["times", "journal", "post", "today", "devoir", "york", "wall street", "washington"]) expect(text).not.toContain(name);
  });
});
