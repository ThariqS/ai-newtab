import { useEffect, useRef, useState } from "react";
import { BUILD_STEPS, LOG_RETENTION, type BuildState } from "@/lib/protocol";

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
  const { stepIndex, detail, narration, logs } = state;
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
            <span className="build-title">Building your homepage</span>
            <span className="build-elapsed">
              {mm}:{ss}
            </span>
          </div>

          <ol className="build-steps">
            {BUILD_STEPS.map((step, i) => {
              const status = i < stepIndex ? "done" : i === stepIndex ? "active" : "pending";
              return (
                <li key={step.label} className={`build-step ${status}`}>
                  <span className="build-marker">{status === "done" ? "✓" : i + 1}</span>
                  <div className="build-step-body">
                    <div className="build-step-label">{step.label}</div>
                    {status === "active" && detail && <div className="build-step-detail">{detail}</div>}
                  </div>
                </li>
              );
            })}
          </ol>

          <div style={{ display: "flex", gap: 10 }}>
            <button className="build-cancel" onClick={onCancel}>
              Cancel
            </button>
            {onBack && (
              <button className="build-cancel" style={{ background: "transparent" }} onClick={onBack}>
                ← Back to homepage
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="build-right">
        <div className="build-panel">
          <div className="build-eyebrow">Agent</div>
          <div className="build-narration" ref={narrRef}>
            {narration || "Warming up — reading what you’ve been browsing…"}
          </div>

          {logs.length > 0 && (
            <>
              <div className="build-eyebrow build-log-label">Activity log</div>
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
