import type { CSSProperties, ReactElement } from "react";
import { nextTheme, type ThemePreference } from "@/lib/theme";
import { useI18n } from "../i18n";

/**
 * Stroke icons in one visual language (24-unit grid, 1.75 stroke, round
 * caps), so the three states read as a set. Colour comes from `currentColor`.
 */
const ICONS: Record<ThemePreference, ReactElement> = {
  system: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  dark: <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />,
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </>
  ),
};

/** One button that cycles System → Dark → Light. The icon shows the current choice. */
export function ThemeToggle({
  theme,
  onCycle,
  style,
}: {
  theme: ThemePreference;
  onCycle: () => void;
  style?: CSSProperties;
}) {
  const { t } = useI18n();
  const words = { current: t(`theme.${theme}`), next: t(`theme.to.${nextTheme(theme)}`) };
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onCycle}
      title={t("theme.title", words)}
      aria-label={t("theme.label", words)}
      data-theme-toggle={theme}
      style={style}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {ICONS[theme]}
      </svg>
    </button>
  );
}
