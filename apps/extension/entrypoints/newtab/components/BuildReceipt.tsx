import { useEffect, useRef } from "react";
import type { BuildReceipt as Receipt } from "@homepage/agent-core";
import { btn } from "./ui";

export function BuildReceipt({ receipt, onClose }: { receipt: Receipt; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  // Focus the heading, not the Close button: focusing a control at the bottom
  // scrolls a long receipt to its end and hides the summary.
  useEffect(() => {
    dialog.current?.showModal();
    title.current?.focus();
  }, []);
  const seconds = Math.max(0, Math.round((Date.parse(receipt.finishedAt) - Date.parse(receipt.startedAt)) / 1000));
  return (
    <dialog ref={dialog} onCancel={onClose} aria-labelledby="receipt-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{ border: 0, borderRadius: 8, padding: 0, width: "90%", maxWidth: 600, maxHeight: "85vh", color: "#333" }}>
      <div style={{ padding: 24, overflowWrap: "anywhere" }}>
        <h2 id="receipt-title" ref={title} tabIndex={-1} style={{ marginTop: 0, outline: "none" }}>What this build read</h2>
        <p>Model: {receipt.model}<br />Duration: {seconds}s</p>
        <p>Started: {new Date(receipt.startedAt).toLocaleString()}<br />
          Finished: {new Date(receipt.finishedAt).toLocaleString()}</p>
        <h3>Domains sent ({receipt.domainsSent.length})</h3>
        <p>History window: {receipt.historyWindowDays} days · {receipt.totalSitesSeen} sites seen</p>
        {receipt.domainsSent.length ? <ul>{receipt.domainsSent.map((domain) => <li key={domain}>{domain}</li>)}</ul> : <p>None</p>}
        <h3>Pages uploaded ({receipt.pagesUploaded.length})</h3>
        {receipt.pagesUploaded.length ? <ul>{receipt.pagesUploaded.map((page, i) => <li key={i}>{page.url} — {page.bytes.toLocaleString()} bytes</li>)}</ul> : <p>None</p>}
        <h3>Pages failed ({receipt.pagesFailed.length})</h3>
        {receipt.pagesFailed.length ? <ul>{receipt.pagesFailed.map((page, i) => <li key={i}>{page.url} — {page.reason}</li>)}</ul> : <p>None</p>}
        {receipt.usage && <><h3>Token usage</h3><p>Input: {receipt.usage.inputTokens.toLocaleString()} · Output: {receipt.usage.outputTokens.toLocaleString()}
          {receipt.usage.cacheReadInputTokens !== undefined && <><br />Cache read: {receipt.usage.cacheReadInputTokens.toLocaleString()}</>}</p></>}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}><button style={btn} onClick={onClose}>Close</button></div>
      </div>
    </dialog>
  );
}
