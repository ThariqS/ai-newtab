import { useEffect, useRef, useState } from "react";
import type { PhaseInfo } from "@homepage/agent-core";
import { formatDuration, type Translate } from "@/lib/i18n";
import { BUILD_STEPS, LOG_RETENTION, type BuildState } from "@/lib/protocol";
import { useI18n } from "../i18n";

/** Full-screen build view: the step list on the left, live narration and log on the right. */
export function BuildProgress({
  state,
  onCancel,
  onBack,
}: {
  state: BuildState;
  onCancel: () => void;
  /** Present when a build is running over an existing homepage — offers a way back to it. */
  onBack?: () => void;
}) {
  const { t } = useI18n();
  const { stepIndex, detail, detailInfo, narration, logs } = state;
  // A detail without info is a tool name ("grep", "read"), the same in every language.
  const detailText = detailInfo ? describePhase(t, detailInfo) : detail;
  const [elapsed, setElapsed] = useState(0);
  const narrRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Keep the streaming panels pinned to their latest line.
  useEffect(() => {
    if (narrRef.current) narrRef.current.scrollTop = narrRef.current.scrollHeight;
  }, [narration]);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="build">
      <div className="build-left">
        <div className="build-panel">
          <div className="build-top">
            <span className="build-title">{t("progress.title")}</span>
            <span className="build-elapsed">
              {mm}:{ss}
            </span>
          </div>

          <ol className="build-steps">
            {BUILD_STEPS.map((step, i) => {
              const status = i < stepIndex ? "done" : i === stepIndex ? "active" : "pending";
              return (
                <li key={step.id} className={`build-step ${status}`}>
                  <span className="build-marker">{status === "done" ? "✓" : i + 1}</span>
                  <div className="build-step-body">
                    <div className="build-step-label">{t(`progress.step.${step.id}`)}</div>
                    {status === "active" && detailText && <div className="build-step-detail">{detailText}</div>}
                  </div>
                </li>
              );
            })}
          </ol>

          <div style={{ display: "flex", gap: 10 }}>
            <button className="build-cancel" onClick={onCancel}>
              {t("common.cancel")}
            </button>
            {onBack && (
              <button className="build-cancel" style={{ background: "transparent" }} onClick={onBack}>
                ← {t("progress.back")}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="build-right">
        <div className="build-panel">
          <div className="build-eyebrow">{t("progress.agent")}</div>
          <div className="build-narration" ref={narrRef}>
            {narration || t("progress.warmingUp")}
          </div>

          {logs.length > 0 && (
            <>
              <div className="build-eyebrow build-log-label">{t("progress.log")}</div>
              <pre className="build-log" ref={logRef}>
                {logs.slice(-LOG_RETENTION).join("\n")}
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function describePhase(t: Translate, info: PhaseInfo): string {
  switch (info.kind) {
    case "days":
      return t("progress.days", { count: info.count });
    case "pages":
      return t("progress.pages", { count: info.count });
    case "batch-submitting":
      return t("progress.batchSubmitting");
    case "batch-waiting":
      return t("progress.batchWaiting", { duration: formatDuration(t, info.seconds) });
  }
}
