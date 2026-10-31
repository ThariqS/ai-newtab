/**
 * What a catalog is missing or gets wrong, against the English source. Used by
 * `pnpm i18n:check` and the tests; not imported by the extension itself.
 */
import { SOURCE_LOCALE, splitTags, type Locale, type Message, type MessageKey } from ".";

export interface CatalogAudit {
  code: string;
  /** Keys English has and this catalog doesn't (they show in English). */
  missing: MessageKey[];
  /** Keys this catalog has and English doesn't (never shown). */
  unknown: string[];
  /** Messages whose {placeholders} or <tags> differ from English. */
  mismatched: Array<{ key: MessageKey; expected: string[]; actual: string[] }>;
  /** Plural sets without `other`, or with a category the language doesn't use. */
  badPlurals: Array<{ key: MessageKey; problem: string }>;
}

const source = SOURCE_LOCALE.messages as Record<MessageKey, Message>;
export const MESSAGE_KEYS = Object.keys(source) as MessageKey[];

/** The placeholders and tags a message uses, sorted, across all its plural forms. */
export function markers(message: Message): string[] {
  const texts = typeof message === "string" ? [message] : Object.values(message);
  const found = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(/\{(\w+)\}/g)) found.add(`{${match[1]}}`);
    for (const part of splitTags(text)) if (part.tag) found.add(`<${part.tag}>`);
  }
  return [...found].sort();
}

export function auditCatalog(locale: Locale): CatalogAudit {
  const messages = locale.messages as Record<string, Message | undefined>;
  const categories = new Intl.PluralRules(locale.code).resolvedOptions().pluralCategories;
  const audit: CatalogAudit = { code: locale.code, missing: [], unknown: [], mismatched: [], badPlurals: [] };

  for (const key of MESSAGE_KEYS) {
    const message = messages[key];
    if (message === undefined) {
      audit.missing.push(key);
      continue;
    }
    // Compared on the union of the plural forms: "the last day" may drop the {count} that "the last {count} days" needs.
    const expected = markers(source[key]);
    const actual = markers(message);
    if (expected.join() !== actual.join()) audit.mismatched.push({ key, expected, actual });
    if (typeof message !== "string") {
      if (!message.other) audit.badPlurals.push({ key, problem: "no `other` form" });
      for (const category of Object.keys(message)) {
        if (!categories.includes(category as Intl.LDMLPluralRule)) {
          audit.badPlurals.push({ key, problem: `"${category}" is not a plural category of ${locale.code} (${categories.join(", ")})` });
        }
      }
    }
  }
  for (const key of Object.keys(messages)) if (!(key in source)) audit.unknown.push(key);
  return audit;
}
