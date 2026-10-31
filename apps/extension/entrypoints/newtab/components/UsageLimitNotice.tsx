import { CHATGPT_USAGE_URL } from "@homepage/agent-core";
import type { Translator } from "@/lib/i18n";
import type { BuildNotice } from "@/lib/protocol";
import { useI18n } from "../i18n";
import { btn, btnQuiet as quiet, noticeBox } from "./ui";

/** "… reached at 5:19 PM" today, "… reached on Tue, Oct 27" otherwise, in the interface's language. */
function title({ t, locale }: Translator, at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return t("notice.title");
  if (date.toDateString() === new Date().toDateString()) {
    return t("notice.titleAt", { time: date.toLocaleTimeString(locale.code, { hour: "numeric", minute: "2-digit" }) });
  }
  return t("notice.titleOn", { date: date.toLocaleDateString(locale.code, { weekday: "short", month: "short", day: "numeric" }) });
}

/**
 * The ChatGPT plan's allowance for apps is used up. Nothing failed: OpenAI's
 * guidance for this code is to stop sending plan requests and point at the
 * usage page, so it reads as a notice with the ways forward, not as an error.
 *
 * - `panel` replaces the empty state when there is no homepage yet;
 * - `banner` sits over the last homepage, which stays on screen.
 */
export function UsageLimitNotice({
  notice,
  variant,
  apiKeySaved,
  onUseApiKey,
  onRetry,
  onDismiss,
}: {
  notice: BuildNotice;
  variant: "panel" | "banner";
  /** An OpenAI API key is already saved, so switching can build right away. */
  apiKeySaved: boolean;
  onUseApiKey: () => void;
  onRetry: () => void;
  onDismiss?: () => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const heading = title(i18n, notice.at);
  const small = variant === "banner" ? { padding: "4px 10px", fontSize: 13 } : {};

  const actions = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
      <a
        href={CHATGPT_USAGE_URL}
        target="_blank"
        rel="noreferrer"
        data-testid="usage-link"
        style={{ ...btn, ...small, textDecoration: "none", display: "inline-block" }}
      >
        {t("notice.seeUsage")} ↗
      </a>
      <button style={{ ...quiet, ...small }} onClick={onUseApiKey} data-testid="use-api-key">
        {t(apiKeySaved ? "notice.buildWithKey" : "notice.useKey")}
      </button>
      {variant === "banner" && (
        // The empty state already has its own build button right below.
        <button style={{ ...quiet, ...small }} onClick={onRetry}>
          {t("notice.tryAgain")}
        </button>
      )}
    </div>
  );

  if (variant === "banner") {
    return (
      <div
        role="status"
        data-testid="usage-limit-notice"
        style={{
          ...noticeBox,
          position: "fixed",
          top: 20,
          left: 20,
          right: 260,
          zIndex: 999,
          padding: "10px 14px",
          borderRadius: 6,
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <div style={{ flex: 1 }}>
          <b>{heading}.</b> {t("notice.banner")}
          {actions}
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            title={t("common.dismiss")}
            style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
          >
            ✕
          </button>
        )}
      </div>
    );
  }

  return (
    <div role="status" data-testid="usage-limit-notice" style={{ ...noticeBox, margin: "16px 0", padding: 16, borderRadius: 6 }}>
      <div style={{ fontWeight: 600, fontSize: 15 }}>{heading}</div>
      <p style={{ margin: "6px 0 0", lineHeight: 1.5 }}>{t("notice.panel")}</p>
      {actions}
      <p style={{ margin: "10px 0 0", fontSize: 12, opacity: 0.8 }}>{t("notice.panelFooter")}</p>
    </div>
  );
}
