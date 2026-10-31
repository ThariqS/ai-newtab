/**
 * Interface translations, for the new-tab page and the service worker alike
 * (no DOM, no React here; the page's binding is entrypoints/newtab/i18n.tsx).
 *
 * Each language is one catalog in ./locales, registered in ./locales/index.ts.
 * English (en.ts) is the source: it defines every key, and a key a catalog
 * leaves out falls back to it. A message is a string with {placeholders}, or,
 * when it depends on a number, a set of plural forms picked by
 * Intl.PluralRules on its `count`. Rich text marks spans with <tag>…</tag>
 * pairs that the page renders as elements. See ./README.md to add a language.
 */
import { LOCALES } from "./locales";
import en from "./locales/en";

export { LOCALES };

export type MessageKey = keyof typeof en;

/** Plural forms by CLDR category. `other` is required and is the fallback for any category left out. */
export type PluralForms = { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>;
export type Message = string | PluralForms;

/** A language's catalog: no unknown keys, a plural stays a plural, missing keys fall back to English. */
export type Translation = { [K in MessageKey]?: (typeof en)[K] extends string ? string : PluralForms };

export interface Locale {
  /** BCP 47 language tag: "fr", "pt-BR". */
  code: string;
  /** The language's name in that language, as the picker lists it. */
  name: string;
  messages: Translation;
}

/** A locale code, or "auto" to follow the browser's languages. */
export type LanguagePreference = string;

export type Params = Record<string, string | number>;

export type Translate = (key: MessageKey, params?: Params) => string;

/** A message cut into plain text and <tag>…</tag> spans, placeholders filled in. */
export type MessagePart = { text: string; tag?: string };

export interface Translator {
  locale: Locale;
  t: Translate;
  parts(key: MessageKey, params?: Params): MessagePart[];
}

export const SOURCE_LOCALE: Locale = LOCALES[0]!;

export function findLocale(code: string | null | undefined): Locale | undefined {
  return LOCALES.find((locale) => locale.code === code);
}

/** A stored preference, or "auto" when it is missing or names a language no longer offered. */
export function normalizePreference(value: unknown): LanguagePreference {
  return typeof value === "string" && findLocale(value) ? value : "auto";
}

/**
 * The locale to show: the preference when it names one, otherwise the first of
 * the browser's languages that has a catalog (the exact tag, then its base
 * language: "fr-CA" finds "fr"), otherwise English.
 */
export function resolveLocale(
  preference: LanguagePreference | undefined,
  browserLanguages: readonly string[] = navigatorLanguages(),
  locales: readonly Locale[] = LOCALES,
): Locale {
  const chosen = preference && preference !== "auto" ? locales.find((locale) => locale.code === preference) : undefined;
  if (chosen) return chosen;
  for (const tag of browserLanguages) {
    const wanted = tag.toLowerCase();
    const exact = locales.find((locale) => locale.code.toLowerCase() === wanted);
    if (exact) return exact;
    const base = wanted.split("-")[0];
    const sameLanguage = locales.find((locale) => locale.code.toLowerCase().split("-")[0] === base);
    if (sameLanguage) return sameLanguage;
  }
  return SOURCE_LOCALE;
}

function navigatorLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

export function createTranslator(locale: Locale): Translator {
  const plurals = new Intl.PluralRules(locale.code);
  const numbers = new Intl.NumberFormat(locale.code);

  const raw = (key: MessageKey, params?: Params): string => {
    const message: Message = locale.messages[key] ?? en[key];
    if (typeof message === "string") return message;
    const count = Number(params?.count ?? 0);
    return message[plurals.select(count)] ?? message.other;
  };
  // Unknown placeholders stay visible, so a missing parameter shows up on screen instead of vanishing.
  const fill = (text: string, params?: Params) =>
    params
      ? text.replace(/\{(\w+)\}/g, (match, name: string) => {
          const value = params[name];
          if (value === undefined) return match;
          return typeof value === "number" ? numbers.format(value) : value;
        })
      : text;

  return {
    locale,
    t: (key, params) => fill(raw(key, params), params),
    parts: (key, params) => splitTags(raw(key, params)).map((part) => ({ ...part, text: fill(part.text, params) })),
  };
}

/** "a <b>bold</b> word" → [{text: "a "}, {text: "bold", tag: "b"}, {text: " word"}]. Tags don't nest. */
export function splitTags(message: string): MessagePart[] {
  const parts: MessagePart[] = [];
  const pattern = /<(\w+)>([\s\S]*?)<\/\1>/g;
  let last = 0;
  for (let match = pattern.exec(message); match; match = pattern.exec(message)) {
    if (match.index > last) parts.push({ text: message.slice(last, match.index) });
    parts.push({ text: match[2]!, tag: match[1]! });
    last = match.index + match[0].length;
  }
  if (last < message.length) parts.push({ text: message.slice(last) });
  return parts;
}

/** "45 s", "3 min", "1 h 5 min", in the translator's words. */
export function formatDuration(t: Translate, seconds: number): string {
  if (seconds < 90) return t("duration.seconds", { count: seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return t("duration.minutes", { count: minutes });
  return t("duration.hours", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}
