import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelInfo } from "@homepage/agent-core";
import {
  AGENT_PORT,
  INITIAL_AUTH_STATE,
  INITIAL_BUILD_STATE,
  LOG_RETENTION,
  type AuthState,
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
      return { ...state, running: false, phase: "error", error: msg.message, notice: null };
    case "notice":
      return { ...state, running: false, phase: null, error: null, notice: msg.notice };
    default:
      return state;
  }
}

export interface ModelsState {
  models: ModelInfo[];
  loading: boolean;
  error: string | null;
}

/**
 * Thin client onto the worker-hosted build. Connects the port, subscribes for a
 * snapshot, and reduces incoming deltas into React state. Every open tab runs
 * one of these, so they all render the same live run. `onDone` receives the
 * new homepage's raw TSX. The same port carries the sign-in state and the
 * model list, so the page never touches a token.
 */
export function useHomepageBuild(onDone: (code: string) => void) {
  const [state, setState] = useState<BuildState>(INITIAL_BUILD_STATE);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [models, setModels] = useState<ModelsState>({ models: [], loading: false, error: null });
  const portRef = useRef<Port | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    let disposed = false;

    const handleMsg = (raw: unknown) => {
      const msg = raw as BuildMsg;
      switch (msg.kind) {
        case "done":
          onDoneRef.current(msg.code);
          break;
        case "auth":
          setAuth(msg.state);
          return;
        case "models":
          setModels({ models: msg.models, loading: false, error: msg.error });
          return;
      }
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
        // ~5 min port cap). Reconnecting wakes it, and its tick() resumes any
        // interrupted run.
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

  const post = useCallback((msg: PageMsg) => portRef.current?.postMessage(msg), []);

  const build = useCallback(
    (opts?: { resume?: boolean }) => {
      post({ kind: "startBuild", resume: opts?.resume });
      // Optimistic: flip to the build screen now; the worker's snapshot and
      // deltas take over from here.
      setState({ ...INITIAL_BUILD_STATE, running: true, phase: "setup" });
    },
    [post],
  );

  const cancel = useCallback(() => post({ kind: "cancel" }), [post]);
  const dismissNotice = useCallback(() => {
    setState((s) => ({ ...s, notice: null }));
    post({ kind: "dismissNotice" });
  }, [post]);
  /** Ask the worker to re-evaluate credentials after the page saved a key or switched engine. */
  const refreshAuth = useCallback(() => post({ kind: "refreshAuth" }), [post]);

  const signIn = useCallback(
    (opts?: { newAccount?: boolean; promptConsent?: boolean }) => {
      setAuth((a) => {
        const base = a ?? INITIAL_AUTH_STATE;
        return { ...base, openai: { ...base.openai, pending: true, error: null } };
      });
      post({ kind: "signIn", newAccount: opts?.newAccount, promptConsent: opts?.promptConsent });
    },
    [post],
  );
  const cancelSignIn = useCallback(() => post({ kind: "cancelSignIn" }), [post]);
  const signOut = useCallback((opts?: { forget?: boolean }) => post({ kind: "signOut", forget: opts?.forget }), [post]);

  const loadModels = useCallback(
    (opts?: { refresh?: boolean }) => {
      setModels((m) => ({ ...m, loading: true, error: null }));
      post({ kind: "listModels", refresh: opts?.refresh });
    },
    [post],
  );

  return { state, auth, models, build, cancel, dismissNotice, refreshAuth, signIn, cancelSignIn, signOut, loadModels };
}
