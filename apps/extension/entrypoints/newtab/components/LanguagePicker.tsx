import type { CSSProperties } from "react";
import { LOCALES, resolveLocale } from "@/lib/i18n";
import { useI18n } from "../i18n";
import { selectStyle } from "./ui";

/**
 * The interface language: "the browser's" or one of the catalogs, each listed
 * under its own name so anyone can find theirs. Applies at once, everywhere.
 */
export function LanguagePicker({ style }: { style?: CSSProperties }) {
  const { t, preference, setPreference } = useI18n();
  const browserLocale = resolveLocale("auto");
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, ...style }}>
      <span aria-hidden="true">🌐</span>
      {t("settings.language.label")}
      <select
        data-testid="language-select"
        value={preference}
        onChange={(e) => void setPreference(e.target.value)}
        style={selectStyle}
      >
        <option value="auto">{t("settings.language.auto", { language: browserLocale.name })}</option>
        {LOCALES.map((locale) => (
          <option key={locale.code} value={locale.code} lang={locale.code}>
            {locale.name}
          </option>
        ))}
      </select>
    </label>
  );
}
