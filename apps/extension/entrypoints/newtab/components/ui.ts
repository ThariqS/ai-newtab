import type { CSSProperties } from "react";

export const btn: CSSProperties = {
  padding: "8px 16px",
  borderRadius: 4,
  border: "none",
  backgroundColor: "#0066cc",
  color: "white",
  cursor: "pointer",
  fontSize: 14,
};

export const errorBox: CSSProperties = {
  background: "#fdeceb",
  border: "1px solid #f5c6cb",
  color: "#a02620",
  fontSize: 13,
};

/** Something to know, not a failure (e.g. the ChatGPT usage limit). */
export const noticeBox: CSSProperties = {
  background: "#fff8e6",
  border: "1px solid #f0d78c",
  color: "#5c4300",
  fontSize: 13,
};
