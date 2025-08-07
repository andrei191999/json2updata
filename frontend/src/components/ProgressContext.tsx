import { createContext, useContext, useState, type ReactNode } from "react";
import {
  Backdrop,
  Box,
  Typography,
  LinearProgress,
  IconButton,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

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
  cur: number;
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

  /* helpers */
  const start: ProgressAPI["start"] = (total, first = "") =>
    setState({
      pct: total ? 0 : -1, // indeterminate if 0
      label: first,
      mode: "running",
      max: total,
      cur: 0,
    });

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

  const api: ProgressAPI = {
    start,
    setLabel,
    setTotal,
    step,
    done,
    error,
    dismiss,
    active: state.mode !== "idle",
    cur: state.cur,
  };

  /* UI colours */
  const barColor =
    state.mode === "error"
      ? "error"
      : state.mode === "done"
      ? "success"
      : "primary";

  return (
    <Ctx.Provider value={api}>
      <Backdrop sx={{ color: "#fff", zIndex: 2000 }} open={api.active}>
        <Box sx={{ width: 380, p: 2 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
            <Typography>
              {state.label}{" "}
              {state.mode === "running" && `(${state.cur}/${state.max})`}
            </Typography>
            {(state.mode === "error" || state.mode === "done") && (
              <IconButton onClick={dismiss} size="small" sx={{ color: "#fff" }}>
                <CloseIcon fontSize="small" />
              </IconButton>
            )}
          </Box>

          <LinearProgress
            sx={{ mt: 1 }}
            variant={state.pct < 0 ? "indeterminate" : "determinate"}
            value={state.pct < 0 ? 0 : state.pct}
            color={barColor}
          />
        </Box>
      </Backdrop>

      {children}
    </Ctx.Provider>
  );
}

/* ───────── hook ───────── */
export function useProgress() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProgress must be inside ProgressProvider");
  return ctx;
}
