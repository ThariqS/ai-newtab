import { describe, expect, test } from "bun:test";
import { ENGINES, SKINS } from "@homepage/agent-core";
import {
  LOCALES,
  createTranslator,
  findLocale,
  formatDuration,
  normalizePreference,
  resolveLocale,
  splitTags,
  type Locale,
} from "../apps/extension/lib/i18n";
import { MESSAGE_KEYS, auditCatalog } from "../apps/extension/lib/i18n/audit";
import en from "../apps/extension/lib/i18n/locales/en";
import { BUILD_STEPS } from "../apps/extension/lib/protocol";

const fr = findLocale("fr")!;
const NBSP = " ";

describe("catalogs", () => {
  for (const locale of LOCALES) {
    test(`${locale.code}: placeholders, tags and plural forms match English, no unknown keys`, () => {
      const audit = auditCatalog(locale);
      expect(audit.unknown).toEqual([]);
      expect(audit.mismatched).toEqual([]);
      expect(audit.badPlurals).toEqual([]);
    });

    test(`${locale.code}: the extension name and description fit Chrome's limits`, () => {
      const t = createTranslator(locale).t;
      expect(t("manifest.name").length).toBeLessThanOrEqual(45);
      expect(t("manifest.description").length).toBeLessThanOrEqual(132);
    });
  }

  test("French is complete", () => {
    expect(auditCatalog(fr).missing).toEqual([]);
  });

  test("French puts a non-breaking space before : ; ! ? and inside « »", () => {
    const loose: string[] = [];
    for (const key of MESSAGE_KEYS) {
      const message = fr.messages[key]!;
      for (const text of typeof message === "string" ? [message] : Object.values(message)) {
        if (/ [:;!?»]|« /.test(text)) loose.push(`${key}: ${text}`);
      }
    }
    expect(loose).toEqual([]);
  });

  test("every look, engine and build step has its message", () => {
    const keys = new Set<string>(MESSAGE_KEYS);
    for (const skin of SKINS) expect(keys.has(`look.${skin.id}`)).toBe(true);
    for (const engine of ENGINES) expect(keys.has(`engine.${engine.id}`)).toBe(true);
    for (const step of BUILD_STEPS) expect(keys.has(`progress.step.${step.id}`)).toBe(true);
  });
});

describe("choosing the language", () => {
  // A fixed set, so these hold whatever languages get added later.
  const set: Locale[] = [findLocale("en")!, fr, { code: "pt-BR", name: "Português (Brasil)", messages: {} }];
  const pick = (preference: string, browser: string[]) => resolveLocale(preference, browser, set).code;

  test("a stored choice wins over the browser", () => {
    expect(pick("fr", ["en-US"])).toBe("fr");
    expect(pick("en", ["fr-FR"])).toBe("en");
  });

  test("auto follows the browser: the exact tag, then its language, then English", () => {
    expect(pick("auto", ["fr-CA", "en"])).toBe("fr");
    expect(pick("auto", ["pt-BR"])).toBe("pt-BR");
    expect(pick("auto", ["pt-PT"])).toBe("pt-BR");
    expect(pick("auto", ["de-DE", "en-GB"])).toBe("en");
    expect(pick("auto", ["de", "ja"])).toBe("en");
    expect(pick("auto", [])).toBe("en");
  });

  test("an unknown stored value is treated as auto", () => {
    expect(normalizePreference("fr")).toBe("fr");
    expect(normalizePreference("xx")).toBe("auto");
    expect(normalizePreference(undefined)).toBe("auto");
    expect(pick("xx", ["fr"])).toBe("fr");
  });
});

describe("translating", () => {
  test("fills placeholders and picks plural forms with the language's rules", () => {
    const english = createTranslator(findLocale("en")!).t;
    const french = createTranslator(fr).t;
    expect(english("error.activityLog", { count: 1 })).toBe("Activity log (1 line)");
    expect(english("error.activityLog", { count: 0 })).toBe("Activity log (0 lines)");
    // French uses the singular for 0 and 1.
    expect(french("error.activityLog", { count: 0 })).toBe("Journal d’activité (0 ligne)");
    expect(french("error.activityLog", { count: 2 })).toBe("Journal d’activité (2 lignes)");
    expect(french("toolbar.building", { step: 2, total: 5 })).toBe("Génération… 2/5");
  });

  test("formats numbers in the language", () => {
    expect(createTranslator(fr).t("progress.pages", { count: 1234 })).toBe(`${new Intl.NumberFormat("fr").format(1234)} pages`);
  });

  test("a key a catalog leaves out falls back to English; a missing parameter stays visible", () => {
    const partial: Locale = { code: "de", name: "Deutsch", messages: { "app.title": "Ihre Startseite" } };
    const t = createTranslator(partial).t;
    expect(t("app.title")).toBe("Ihre Startseite");
    expect(t("app.loading")).toBe(en["app.loading"]);
    expect(t("toolbar.building", { step: 1 })).toBe("Building… 1/{total}");
  });

  test("rich text: tags split out, placeholders filled inside and outside them", () => {
    expect(createTranslator(fr).parts("settings.key.anthropic", { status: "enregistrée" })).toEqual([
      { text: `Clé API Anthropic${NBSP}: ` },
      { text: "enregistrée", tag: "b" },
    ]);
    expect(splitTags("plain")).toEqual([{ text: "plain" }]);
    expect(splitTags("a <code>x</code> and <link>y</link>.")).toEqual([
      { text: "a " },
      { text: "x", tag: "code" },
      { text: " and " },
      { text: "y", tag: "link" },
      { text: "." },
    ]);
  });

  test("durations for the batch queue", () => {
    const t = createTranslator(fr).t;
    expect(formatDuration(t, 45)).toBe(`45${NBSP}s`);
    expect(formatDuration(t, 180)).toBe(`3${NBSP}min`);
    expect(formatDuration(t, 3900)).toBe(`65${NBSP}min`); // hours only past 90 minutes, as in the engine's log line
    expect(formatDuration(t, 6000)).toBe(`1${NBSP}h 40${NBSP}min`);
  });
});
