import { useCallback, useEffect, useRef, useState } from "react";
import {
  AGENT_PORT,
  INITIAL_BUILD_STATE,
  LOG_RETENTION,
  type BuildMsg,
  type BuildState,
  type PageMsg,
} from "@/lib/protocol";
import { KEYS, extensionStore } from "@/lib/storage";

type Port = ReturnType<typeof browser.runtime.connect>;

/** Reduce a worker → page message into the local mirror of the build state. */
function reduce(state: BuildState, msg: BuildMsg): BuildState {
  switch (msg.kind) {
    case "snapshot":
      return msg.state;
    case "phase":
      return {
        ...state,
        running: true,
        phase: msg.phase,
        stepIndex: Math.max(state.stepIndex, msg.stepIndex),
        detail: msg.detail,
      };
    case "text":
      return { ...state, narration: state.narration + msg.chunk };
    case "log":
      return { ...state, logs: [...state.logs.slice(-LOG_RETENTION), msg.line] };
    case "done":
      return { ...state, running: false, phase: "done" };
    case "error":
      return { ...state, running: false, phase: "error", error: msg.message };
  }
}

/**
 * Thin client onto the worker-hosted build. Connects the port, subscribes for a
 * snapshot, and reduces incoming deltas into React state. Every open tab runs
 * one of these, so they all render the same live run. `onDone` receives the
 * new homepage's raw TSX.
 */
export function useHomepageBuild(onDone: (code: string) => void) {
  const [state, setState] = useState<BuildState>(INITIAL_BUILD_STATE);
  const portRef = useRef<Port | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    let disposed = false;

    const handleMsg = (raw: unknown) => {
      const msg = raw as BuildMsg;
      if (msg.kind === "done") onDoneRef.current(msg.code);
      setState((s) => reduce(s, msg));
    };

    const connect = () => {
      if (disposed) return;
      const port = browser.runtime.connect({ name: AGENT_PORT });
      portRef.current = port;
      port.onMessage.addListener(handleMsg);
      port.onDisconnect.addListener(() => {
        portRef.current = null;
        // A disconnect means the worker was torn down (update, crash, or the
        // ~5 min port cap). Reconnecting wakes it, and its tick() reattaches to
        // any interrupted run.
        if (!disposed) setTimeout(connect, 500);
      });
      port.postMessage({ kind: "subscribe" } satisfies PageMsg);
    };

    connect();

    // Paint last-known state instantly if the worker is asleep — the snapshot
    // from the freshly woken worker follows.
    void extensionStore.get<BuildState>(KEYS.buildSnapshot).then((snap) => {
      if (snap?.running) setState((s) => (s.running || s.phase ? s : snap));
    });

    return () => {
      disposed = true;
      portRef.current?.disconnect();
      portRef.current = null;
    };
  }, []);

  const build = useCallback((opts?: { resume?: boolean }) => {
    portRef.current?.postMessage({ kind: "startBuild", resume: opts?.resume } satisfies PageMsg);
    // Optimistic: flip to the build screen now; the worker's snapshot and
    // deltas take over from here.
    setState({ ...INITIAL_BUILD_STATE, running: true, phase: "setup" });
  }, []);

  const cancel = useCallback(() => {
    portRef.current?.postMessage({ kind: "cancel" } satisfies PageMsg);
  }, []);

  return { state, build, cancel };
}
