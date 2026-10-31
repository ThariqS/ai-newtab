import type { CSSProperties } from "react";
import { LOCALES, resolveLocale } from "@/lib/i18n";
import { useI18n } from "../i18n";
import { selectStyle } from "./ui";

/**
 * The interface language: "the browser's" or one of the catalogs, each listed
 * under its own name so anyone can find theirs. Applies at once, everywhere.
 */
export function LanguageSelect({ id, className, style }: { id?: string; className?: string; style?: CSSProperties }) {
  const { t, preference, setPreference } = useI18n();
  const browserLocale = resolveLocale("auto");
  return (
    <select
      id={id}
      data-testid="language-select"
      value={preference}
      onChange={(e) => void setPreference(e.target.value)}
      className={className}
      style={style}
    >
      <option value="auto">{t("settings.language.auto", { language: browserLocale.name })}</option>
      {LOCALES.map((locale) => (
        <option key={locale.code} value={locale.code} lang={locale.code}>
          {locale.name}
        </option>
      ))}
    </select>
  );
}

/** The labelled picker, for screens without the Settings layout (the first screen). */
export function LanguagePicker({ style }: { style?: CSSProperties }) {
  const { t } = useI18n();
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, ...style }}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </svg>
      {t("settings.language.label")}
      <LanguageSelect style={selectStyle} />
    </label>
  );
}
