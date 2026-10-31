import type { CSSProperties } from "react";

/** Shared styles. Colours come from the tokens in styles.css, so they follow the theme. */
export const btn: CSSProperties = {
  padding: "8px 16px",
  borderRadius: 4,
  border: "none",
  backgroundColor: "var(--accent)",
  color: "var(--accent-fg)",
  cursor: "pointer",
  fontSize: 14,
};

/** A secondary button: outlined, on the panel colour. */
export const btnQuiet: CSSProperties = {
  ...btn,
  backgroundColor: "var(--panel)",
  color: "var(--fg)",
  border: "1px solid var(--border)",
};

export const errorBox: CSSProperties = {
  background: "var(--danger-bg)",
  border: "1px solid var(--danger-border)",
  color: "var(--danger-fg)",
  fontSize: 13,
};

/** Something to know, not a failure (e.g. the ChatGPT usage limit). */
export const noticeBox: CSSProperties = {
  background: "var(--notice-bg)",
  border: "1px solid var(--notice-border)",
  color: "var(--notice-fg)",
  fontSize: 13,
};

export const selectStyle: CSSProperties = {
  padding: "4px 8px",
  fontSize: 14,
  borderRadius: 4,
  border: "1px solid var(--border)",
  background: "var(--panel)",
  color: "var(--fg)",
};

export const input: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: 12,
  fontSize: 14,
  borderRadius: 4,
  border: "1px solid var(--border)",
  background: "var(--panel)",
  color: "var(--fg)",
};
