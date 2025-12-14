import {
  createContext,
  useContext,
  useState,
  useRef,
  type ReactNode,
} from "react";

/* ───────── types ───────── */
type Mode = "idle" | "running" | "error" | "done";

interface ProgressState {
  pct: number; // 0-100, or -1 for indeterminate
  label: string;
  mode: Mode;
  max: number; // total steps
  cur: number; // finished steps
}

export interface ProgressAPI {
  /** reset & show bar */
  start: (totalSteps: number, firstLabel?: string) => void;
  setLabel: (label: string) => void;
  /** change total steps on the fly */
  setTotal: (totalSteps: number, label?: string) => void;
  step: (label?: string, inc?: number) => void;
  /** call when everything OK */
  done: (finalLabel?: string) => void;
  /** call on fatal error */
  error: (message: string) => void;
  /** hide manually (only needed after error) */
  dismiss: () => void;
  /** true while visible */
  active: boolean;
  // NEW: expose state for inline rendering
  mode: Mode;
  pct: number;
  label: string;
  max: number;
  cur: number;
  /** cancel current run */
  cancel: () => void;
  /** AbortSignal to pass to axios */
  readonly signal: AbortSignal;
  setCancelHandler: (fn: (() => Promise<void> | void) | null) => void;
}

const Ctx = createContext<ProgressAPI | null>(null);

/* ───────── provider ───────── */
export function ProgressProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProgressState>({
    pct: 0,
    label: "",
    mode: "idle",
    max: 0,
    cur: 0,
  });
  const controllerRef = useRef<AbortController>(new AbortController());

  /* helpers */
  const start: ProgressAPI["start"] = (total, first = "") => {
    controllerRef.current = new AbortController();
    setState({
      pct: total ? 0 : -1, // indeterminate if 0
      label: first,
      mode: "running",
      max: total,
      cur: 0,
    });
  };
  /* update label only ------------------------------------------------ */
  const setLabel: ProgressAPI["setLabel"] = (lbl) =>
    setState((s) => ({ ...s, label: lbl }));

  const step: ProgressAPI["step"] = (lbl = "", inc = 1) =>
    setState((s) => {
      if (s.mode !== "running") return s;
      const cur = Math.min(s.cur + inc, s.max);
      return {
        ...s,
        cur,
        pct: s.max ? (cur / s.max) * 100 : -1,
        label: lbl || s.label,
      };
    });

  const done: ProgressAPI["done"] = (final = "Finished") => {
    setState((s) => ({ ...s, pct: 100, label: final, mode: "done" }));
    setTimeout(
      () => setState((s) => (s.mode === "done" ? { ...s, mode: "idle" } : s)),
      800
    );
  };

  const setTotal: ProgressAPI["setTotal"] = (total, lbl) =>
    setState((s) => ({
      ...s,
      max: total,
      pct: (s.cur / total) * 100,
      label: lbl ?? s.label,
    }));

  const error: ProgressAPI["error"] = (msg) =>
    setState({ pct: -1, label: msg, mode: "error", max: 1, cur: 0 });

  const dismiss: ProgressAPI["dismiss"] = () =>
    setState((s) => ({ ...s, mode: "idle" }));

  const cancelHandlers = useRef<(() => Promise<void> | void) | null>(null);

  const cancel: ProgressAPI["cancel"] = async () => {
    // ✅ Show immediate feedback to the user
    setState((s) => ({ ...s, mode: "running", label: "Cancelling..." }));

    controllerRef.current.abort(); // Abort client-side network requests

    try {
      // ✅ Ask backend to stop and wait for the request to complete
      await cancelHandlers.current?.();
    } catch (e) {
      console.warn("Cancel request failed", e);
    } finally {
      // ✅ Now, dismiss the progress bar
      cancelHandlers.current = null; // Clear the handler
      setState((s) => ({ ...s, mode: "idle" }));
    }
  };

  // expose a setter so batchTransform can register the backend kill
  function setCancelHandler(fn: (() => Promise<void> | void) | null) {
    cancelHandlers.current = fn;
  }

  const api: ProgressAPI = {
    start,
    setLabel,
    setTotal,
    step,
    done,
    error,
    dismiss,
    cancel,
    get signal() {
      return controllerRef.current.signal;
    },
    active: state.mode !== "idle",
    // expose state
    mode: state.mode,
    pct: state.pct,
    label: state.label,
    max: state.max,
    cur: state.cur,
    setCancelHandler,
  };

  const barColor =
    state.mode === "error"
      ? "error"
      : state.mode === "done"
      ? "success"
      : "primary";

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

/* ───────── hook ───────── */
export function useProgress() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProgress must be inside ProgressProvider");
  return ctx;
}
