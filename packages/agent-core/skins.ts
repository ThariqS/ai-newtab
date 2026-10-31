/**
 * Looks ("skins") the host can apply to a generated homepage without
 * rebuilding it. They work because the component contract (prompt.ts) makes
 * the model take every font and colour from the custom properties below and
 * mark its structure with `data-part` attributes; a skin only redefines the
 * properties on `html[data-skin=…]` and restyles a few parts.
 *
 * Each skin is inspired by a well-known newspaper's typography and palette
 * without using its name or assets, and relies on system fonts only.
 */

/** The custom properties every generated page must define and use. */
export const LOOK_TOKENS = [
  "--paper",
  "--ink",
  "--ink-muted",
  "--rule",
  "--accent",
  "--font-masthead",
  "--font-headline",
  "--font-body",
  "--font-label",
  "--masthead-weight",
  "--masthead-transform",
  "--masthead-spacing",
  "--headline-weight",
  "--headline-spacing",
  "--label-spacing",
  "--rule-width",
] as const;

/** The structural parts the model marks with `data-part`. */
export const LOOK_PARTS = [
  "page",
  "masthead",
  "tagline",
  "dateline",
  "kicker",
  "lead",
  "headline",
  "deck",
  "body",
  "section",
  "section-label",
  "item",
  "summary",
  "source",
  "briefs",
  "coming-up",
] as const;

export type SkinId = "metropolitan" | "ledger" | "capital" | "nationwide" | "boreal";

export interface SkinTokens {
  paper: string;
  ink: string;
  inkMuted: string;
  rule: string;
  accent: string;
}

export interface Skin {
  id: SkinId;
  label: string;
  /** One line, shown under the picker. */
  description: string;
  fonts: { masthead: string; headline: string; body: string; label: string };
  type: {
    mastheadWeight: number;
    mastheadTransform: "none" | "uppercase" | "lowercase";
    mastheadSpacing: string;
    headlineWeight: number;
    headlineSpacing: string;
    labelSpacing: string;
    ruleWidth: string;
  };
  light: SkinTokens;
  dark: SkinTokens;
  /** Extra rules on `data-part` elements; `html[data-skin="<id>"]` is prepended to every selector. */
  parts: string;
}

const SERIF_BODY = 'Georgia, "Iowan Old Style", "Times New Roman", Times, serif';
const BLACKLETTER = '"Old English Text MT", "Canterbury", "UnifrakturCook", "Didot", "Hoefler Text", Georgia, serif';
const SANS = '"Helvetica Neue", Helvetica, Arial, "Segoe UI", sans-serif';

export const SKINS: Skin[] = [
  {
    id: "metropolitan",
    label: "Metropolitan",
    description: "Blackletter masthead, serif headlines, black on white, a quiet blue for links.",
    fonts: { masthead: BLACKLETTER, headline: '"Georgia", "Iowan Old Style", "Times New Roman", serif', body: SERIF_BODY, label: SANS },
    type: { mastheadWeight: 400, mastheadTransform: "none", mastheadSpacing: "0", headlineWeight: 700, headlineSpacing: "-0.01em", labelSpacing: "0.08em", ruleWidth: "1px" },
    light: { paper: "#ffffff", ink: "#121212", inkMuted: "#5a5a5a", rule: "#dcdcdc", accent: "#326891" },
    dark: { paper: "#121212", ink: "#ededed", inkMuted: "#a3a3a3", rule: "#333333", accent: "#7fb0d8" },
    parts: `
[data-part="masthead"] { text-align: center; border-bottom: 3px double var(--rule); padding-bottom: 8px; }
[data-part="dateline"] { border-bottom: var(--rule-width) solid var(--rule); font-family: var(--font-label); font-size: 11px; letter-spacing: var(--label-spacing); text-transform: uppercase; }
[data-part="section-label"] { font-family: var(--font-label); font-weight: 700; font-size: 11px; letter-spacing: var(--label-spacing); text-transform: uppercase; border-top: var(--rule-width) solid var(--ink); border-bottom: none; }
[data-part="deck"] { font-style: normal; color: var(--ink-muted); }
[data-part="kicker"] { color: var(--ink-muted); }`,
  },
  {
    id: "ledger",
    label: "Ledger",
    description: "Dense financial broadsheet: Didone small-caps masthead, hairline double rules, navy accent.",
    fonts: { masthead: '"Bodoni 72", "Didot", "Bodoni MT", "Playfair Display", Georgia, serif', headline: '"Times New Roman", Times, "Iowan Old Style", serif', body: SERIF_BODY, label: SANS },
    type: { mastheadWeight: 700, mastheadTransform: "uppercase", mastheadSpacing: "0.06em", headlineWeight: 700, headlineSpacing: "-0.015em", labelSpacing: "0.14em", ruleWidth: "1px" },
    light: { paper: "#fbfaf7", ink: "#1b1b1b", inkMuted: "#5f5f5f", rule: "#bdbdbd", accent: "#0a2c5c" },
    dark: { paper: "#17191e", ink: "#e9e7e1", inkMuted: "#a7a7a7", rule: "#3a3d44", accent: "#8fb3ea" },
    parts: `
[data-part="masthead"] { text-align: center; border-top: 4px double var(--ink); border-bottom: 4px double var(--ink); padding: 10px 0; font-size: 0.85em; }
[data-part="dateline"] { font-family: var(--font-label); font-size: 10px; letter-spacing: var(--label-spacing); text-transform: uppercase; border-bottom: 1px solid var(--rule); }
[data-part="section-label"] { font-family: var(--font-label); font-size: 10px; letter-spacing: var(--label-spacing); text-transform: uppercase; color: var(--accent); border-top: 2px solid var(--accent); border-bottom: 1px solid var(--rule); padding-top: 4px; }
[data-part="headline"] { line-height: 1.08; }
[data-part="summary"] { font-size: 0.95em; line-height: 1.4; }
[data-part="briefs"] [data-part="headline"] { font-family: var(--font-label); font-size: 0.95em; }
[data-part="source"] { color: var(--accent); }`,
  },
  {
    id: "capital",
    label: "Capital",
    description: "Blackletter masthead over bold sans headlines and serif body, slate accent, strong rules.",
    fonts: { masthead: BLACKLETTER, headline: '"Franklin Gothic Medium", "Helvetica Neue", "Arial Black", Arial, sans-serif', body: SERIF_BODY, label: SANS },
    type: { mastheadWeight: 400, mastheadTransform: "none", mastheadSpacing: "0", headlineWeight: 800, headlineSpacing: "-0.02em", labelSpacing: "0.1em", ruleWidth: "2px" },
    light: { paper: "#ffffff", ink: "#111111", inkMuted: "#555555", rule: "#1a1a1a", accent: "#2f4f6f" },
    dark: { paper: "#101214", ink: "#f0f0f0", inkMuted: "#a8a8a8", rule: "#e6e6e6", accent: "#8fb8dc" },
    parts: `
[data-part="masthead"] { text-align: center; border-bottom: var(--rule-width) solid var(--rule); padding-bottom: 6px; }
[data-part="dateline"] { font-family: var(--font-label); font-weight: 700; font-size: 11px; letter-spacing: var(--label-spacing); text-transform: uppercase; }
[data-part="section-label"] { font-family: var(--font-label); font-weight: 800; font-size: 12px; letter-spacing: var(--label-spacing); text-transform: uppercase; border-top: 3px solid var(--rule); padding-top: 6px; }
[data-part="headline"] { line-height: 1.05; }
[data-part="deck"] { font-family: var(--font-body); font-style: normal; font-size: 1.05em; }
[data-part="kicker"] { color: var(--accent); font-family: var(--font-label); font-weight: 700; }`,
  },
  {
    id: "nationwide",
    label: "Nationwide",
    description: "Bright all-sans look: blue masthead block, colour-coded sections, generous white space.",
    fonts: { masthead: '"Futura", "Avenir Next", "Helvetica Neue", Arial, sans-serif', headline: '"Avenir Next", "Helvetica Neue", Helvetica, Arial, sans-serif', body: '"Avenir Next", "Helvetica Neue", Helvetica, Arial, sans-serif', label: '"Avenir Next", "Helvetica Neue", Arial, sans-serif' },
    type: { mastheadWeight: 800, mastheadTransform: "uppercase", mastheadSpacing: "0.02em", headlineWeight: 700, headlineSpacing: "-0.015em", labelSpacing: "0.08em", ruleWidth: "0px" },
    light: { paper: "#ffffff", ink: "#1f2328", inkMuted: "#5c6570", rule: "#e6e9ee", accent: "#0b6bd1" },
    dark: { paper: "#0f1419", ink: "#eef1f5", inkMuted: "#a2aab5", rule: "#2a323c", accent: "#5aa2ff" },
    parts: `
[data-part="masthead"] { background: var(--accent); color: #ffffff; display: inline-block; padding: 10px 22px; border-radius: 999px; border: none; }
[data-part="tagline"] { font-style: normal; color: var(--ink-muted); }
[data-part="dateline"] { font-size: 12px; letter-spacing: var(--label-spacing); text-transform: uppercase; border: none; color: var(--ink-muted); }
[data-part="section-label"] { --section-accent: #0b6bd1; color: var(--section-accent); border-top: 4px solid var(--section-accent); border-bottom: none; padding-top: 8px; font-weight: 800; font-size: 12px; letter-spacing: var(--label-spacing); text-transform: uppercase; }
[data-part="section"]:nth-of-type(4n+2) [data-part="section-label"] { --section-accent: #1a9a5a; }
[data-part="section"]:nth-of-type(4n+3) [data-part="section-label"] { --section-accent: #d1352b; }
[data-part="section"]:nth-of-type(4n+4) [data-part="section-label"] { --section-accent: #7b3fbd; }
[data-part="headline"] { line-height: 1.15; }
[data-part="deck"] { font-style: normal; }
[data-part="item"] { border-bottom: 1px solid var(--rule); }`,
  },
  {
    id: "boreal",
    label: "Boréal",
    description: "Cream paper, heavy old-style serif masthead, deep red accent, elegant serif throughout.",
    fonts: { masthead: '"Cochin", "Baskerville", "Hoefler Text", "Garamond", Georgia, serif', headline: '"Baskerville", "Hoefler Text", "Cochin", Georgia, serif', body: '"Baskerville", "Hoefler Text", Georgia, serif', label: '"Baskerville", "Hoefler Text", Georgia, serif' },
    type: { mastheadWeight: 700, mastheadTransform: "none", mastheadSpacing: "-0.01em", headlineWeight: 700, headlineSpacing: "-0.005em", labelSpacing: "0.16em", ruleWidth: "1px" },
    light: { paper: "#f7f3ea", ink: "#1e1a17", inkMuted: "#5e5751", rule: "#cfc6b6", accent: "#b31b1b" },
    dark: { paper: "#1b1815", ink: "#efe9df", inkMuted: "#b2a99d", rule: "#3d3731", accent: "#ff7b6b" },
    parts: `
[data-part="masthead"] { text-align: left; color: var(--accent); border-bottom: 2px solid var(--accent); padding-bottom: 4px; }
[data-part="tagline"] { font-style: italic; color: var(--ink-muted); }
[data-part="dateline"] { font-variant: small-caps; letter-spacing: var(--label-spacing); border-bottom: var(--rule-width) solid var(--rule); }
[data-part="section-label"] { font-variant: small-caps; text-transform: none; letter-spacing: var(--label-spacing); color: var(--accent); border-top: 1px solid var(--accent); border-bottom: none; padding-top: 4px; font-size: 14px; }
[data-part="deck"] { font-style: italic; }
[data-part="kicker"] { color: var(--accent); font-variant: small-caps; }`,
  },
];

export function findSkin(id: string | null | undefined): Skin | undefined {
  return SKINS.find((s) => s.id === id);
}

function tokenBlock(skin: Skin, t: SkinTokens): string {
  return [
    `--paper: ${t.paper};`,
    `--ink: ${t.ink};`,
    `--ink-muted: ${t.inkMuted};`,
    `--rule: ${t.rule};`,
    `--accent: ${t.accent};`,
    `--font-masthead: ${skin.fonts.masthead};`,
    `--font-headline: ${skin.fonts.headline};`,
    `--font-body: ${skin.fonts.body};`,
    `--font-label: ${skin.fonts.label};`,
    `--masthead-weight: ${skin.type.mastheadWeight};`,
    `--masthead-transform: ${skin.type.mastheadTransform};`,
    `--masthead-spacing: ${skin.type.mastheadSpacing};`,
    `--headline-weight: ${skin.type.headlineWeight};`,
    `--headline-spacing: ${skin.type.headlineSpacing};`,
    `--label-spacing: ${skin.type.labelSpacing};`,
    `--rule-width: ${skin.type.ruleWidth};`,
  ].join(" ");
}

/**
 * The stylesheet injected into the generated page for a skin. Selectors are
 * rooted at `html[data-skin]` so they outrank the component's own `:root`
 * declarations, in light, system-dark and forced-dark alike. Part rules are
 * prefixed the same way.
 */
export function skinCss(skin: Skin): string {
  const root = `html[data-skin="${skin.id}"]`;
  const parts = skin.parts
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `${root} ${line}`)
    .join("\n");
  return [
    `${root} { ${tokenBlock(skin, skin.light)} }`,
    `@media (prefers-color-scheme: dark) { ${root}:not([data-theme="light"]) { ${tokenBlock(skin, skin.dark)} } }`,
    `${root}[data-theme="dark"] { ${tokenBlock(skin, skin.dark)} }`,
    `${root} body, ${root} [data-part="page"] { background: var(--paper); color: var(--ink); font-family: var(--font-body); }`,
    `${root} [data-part="masthead"] { font-family: var(--font-masthead); font-weight: var(--masthead-weight); text-transform: var(--masthead-transform); letter-spacing: var(--masthead-spacing); }`,
    `${root} [data-part="headline"] { font-family: var(--font-headline); font-weight: var(--headline-weight); letter-spacing: var(--headline-spacing); }`,
    `${root} [data-part="section-label"], ${root} [data-part="source"], ${root} [data-part="dateline"], ${root} [data-part="kicker"] { font-family: var(--font-label); }`,
    `${root} a { color: inherit; } ${root} a:hover { color: var(--accent); }`,
    parts,
  ].join("\n");
}
