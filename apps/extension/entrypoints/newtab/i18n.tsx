/**
 * The page side of lib/i18n: the active language as React context. The choice
 * is stored with the other settings (so the worker words its failures the same
 * way), followed live across tabs, applied to <html lang> and the tab title,
 * and mirrored to localStorage so the next tab paints in it before
 * chrome.storage answers, like the theme.
 */
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createTranslator,
  normalizePreference,
  resolveLocale,
  type LanguagePreference,
  type MessageKey,
  type Params,
  type Translator,
} from "@/lib/i18n";
import { KEYS, saveSetting } from "@/lib/storage";

const MIRROR_KEY = "ai-homepage:language";

/** How each <tag> a message may use is rendered. A message names only the tags its call site passes. */
export type TagRenderers = Record<string, (text: string) => ReactNode>;

export interface I18n extends Translator {
  preference: LanguagePreference;
  setPreference(next: LanguagePreference): Promise<void>;
  /** A message with <tag>…</tag> spans, each rendered by `tags[tag]`. */
  rich(key: MessageKey, tags: TagRenderers, params?: Params): ReactNode;
}

const I18nContext = createContext<I18n | null>(null);

function mirrored(): LanguagePreference {
  try {
    return normalizePreference(localStorage.getItem(MIRROR_KEY));
  } catch {
    return "auto";
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<LanguagePreference>(mirrored);

  useEffect(() => {
    void browser.storage.local.get(KEYS.language).then((stored) => setPreferenceState(normalizePreference(stored[KEYS.language])));
    // Another tab (or Settings in this one) changed it.
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === "local" && KEYS.language in changes) setPreferenceState(normalizePreference(changes[KEYS.language]!.newValue));
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, []);

  const translator = useMemo(() => createTranslator(resolveLocale(preference)), [preference]);

  useEffect(() => {
    document.documentElement.lang = translator.locale.code;
    document.title = translator.t("app.title");
    try {
      localStorage.setItem(MIRROR_KEY, preference);
    } catch {
      // Storage can be unavailable (private window); the chrome.storage copy still applies on load.
    }
  }, [translator, preference]);

  const setPreference = useCallback(async (next: LanguagePreference) => {
    setPreferenceState(normalizePreference(next));
    await saveSetting("language", normalizePreference(next));
  }, []);

  const value = useMemo<I18n>(
    () => ({
      ...translator,
      preference,
      setPreference,
      rich: (key, tags, params) =>
        translator.parts(key, params).map((part, i) => {
          const render = part.tag ? tags[part.tag] : undefined;
          return <Fragment key={i}>{render ? render(part.text) : part.text}</Fragment>;
        }),
    }),
    [translator, preference, setPreference],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const i18n = useContext(I18nContext);
  if (!i18n) throw new Error("useI18n needs an <I18nProvider> above it");
  return i18n;
}
