import React, { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  IconButton,
  Stack,
  Box,
  Typography,
  Autocomplete,
} from "@mui/material";
import { Delete, Plus } from "lucide-react";
import { debug } from "../utils/debug";

/* -------------------------------------------------------------------------- */
/*  1. Mini‑DSL  – simplified concat, smarter token substitution              */
/* -------------------------------------------------------------------------- */
export type StartEnd = number | string; // number (±idx)  OR  substring token

export interface SubstrStep {
  kind: "substr";
  start: StartEnd;
  end?: StartEnd;
  len?: number;
}

export interface ReplaceStep {
  kind: "replace";
  pattern: string;
  repl: string;
  flags?: string;
}

export interface ConcatStep {
  kind: "concat";
  prefix?: string;
  suffix?: string;
}

export type SingleTransform =
  | SubstrStep
  | ReplaceStep
  | ConcatStep
  | { kind: "lower" }
  | { kind: "upper" }
  | { kind: "trim" };

export type TransformChain = SingleTransform[];

/* -------------------------------------------------------------------------- */
/*  2. Helper – run chain with JSON context                                   */
/* -------------------------------------------------------------------------- */
interface EvalCtx {
  json?: Record<string, unknown>;
}

function valOf(token: string, ctx: EvalCtx): string {
  return ctx.json && token in ctx.json ? String(ctx.json[token]) : token;
}

export function applyTransformChain(
  chain: TransformChain,
  v: unknown,
  ctx: EvalCtx = {}
): string {
  return chain.reduce<string>((prev, step) => {
    const s = String(prev);

    switch (step.kind) {
      /* ── SUBSTR ───────────────────────────────────── */
      case "substr": {
        const idx = (val: StartEnd | undefined, fallback: number): number => {
          if (val === undefined) return fallback;
          if (typeof val === "number") return val >= 0 ? val : s.length + val;
          const token = valOf(val, ctx);
          const pos = s.indexOf(token);
          return pos === -1 ? fallback : pos;
        };

        const startIdx = idx(step.start, 0);
        const endIdx =
          step.len !== undefined
            ? startIdx + step.len
            : idx(step.end, s.length);
        return s.slice(startIdx, endIdx);
      }

      /* ── REPLACE ──────────────────────────────────── */
      case "replace": {
        const patt = valOf(step.pattern, ctx);
        const repl = valOf(step.repl, ctx);
        try {
          const re = new RegExp(patt, step.flags ?? "g");
          return s.replace(re, repl);
        } catch {
          return s.split(patt).join(repl);
        }
      }

      /* ── CONCAT ───────────────────────────────────── */
      case "concat": {
        return `${valOf(step.prefix ?? "", ctx)}${s}${valOf(
          step.suffix ?? "",
          ctx
        )}`;
      }

      /* ── ONE‑LINERS ───────────────────────────────── */
      case "lower":
        return s.toLocaleLowerCase();
      case "upper":
        return s.toLocaleUpperCase();
      case "trim":
        return s.trim();
      default:
        return s;
    }
  }, String(v ?? ""));
}

/* -------------------------------------------------------------------------- */
/*  3. Step‑level editor                                                      */
/* -------------------------------------------------------------------------- */
const KIND_OPTIONS: SingleTransform["kind"][] = [
  "substr",
  "replace",
  "concat",
  "lower",
  "upper",
  "trim",
];

interface StepEditorProps {
  step: SingleTransform;
  jsonKeys: string[];
  json: Record<string, unknown> | undefined;
  onChange: (s: SingleTransform) => void;
  onDelete: () => void;
}

function StepEditor({
  step,
  jsonKeys,
  json,
  onChange,
  onDelete,
}: StepEditorProps) {
  const patch = (p: Partial<SingleTransform>) =>
    onChange({ ...(step as any), ...p } as SingleTransform);

  const changeKind = (kind: SingleTransform["kind"]) => {
    const fresh: SingleTransform =
      kind === "substr"
        ? { kind: "substr", start: 0 }
        : kind === "replace"
        ? { kind: "replace", pattern: "", repl: "" }
        : kind === "concat"
        ? { kind: "concat", prefix: "", suffix: "" }
        : { kind };
    onChange(fresh);
  };

  const numOrStr = (v: string): StartEnd =>
    v === "" ? "" : isNaN(Number(v)) ? v : Number(v);

  /* whenever user *selects* (not types) a key, replace with its VALUE */
  const swapIfKey = (token: string): string =>
    json && token in json ? String(json[token]) : token;

  return (
    <Stack
      direction="row"
      alignItems="flex-start"
      spacing={2}
      sx={{ border: "1px solid #eee", p: 1, borderRadius: 1 }}
    >
      <Autocomplete
        options={KIND_OPTIONS}
        value={step.kind}
        onChange={(_, v) => v && changeKind(v)}
        renderInput={(p) => <TextField {...p} label="Function" size="small" />}
        sx={{ minWidth: 140 }}
      />

      {/* ── SUBSTR ─────────────────────────────────────────────── */}
      {step.kind === "substr" && (
        <>
          <TextField
            label="Start"
            size="small"
            value={String(step.start)}
            onChange={(e) =>
              patch({ start: numOrStr(e.target.value) } as Partial<SubstrStep>)
            }
            sx={{ width: 90 }}
          />
          <TextField
            label="End"
            size="small"
            value={String((step as SubstrStep).end ?? "")}
            onChange={(e) =>
              patch({ end: numOrStr(e.target.value) } as Partial<SubstrStep>)
            }
            sx={{ width: 90 }}
          />
          <TextField
            label="Len"
            type="number"
            size="small"
            value={(step as SubstrStep).len ?? ""}
            onChange={(e) =>
              patch({
                len: e.target.value === "" ? undefined : Number(e.target.value),
              } as Partial<SubstrStep>)
            }
            sx={{ width: 90 }}
          />
        </>
      )}

      {/* ── REPLACE ────────────────────────────────────────────── */}
      {step.kind === "replace" && (
        <>
          <Autocomplete
            freeSolo
            options={jsonKeys}
            inputValue={(step as ReplaceStep).pattern}
            onInputChange={(_, v) =>
              patch({ pattern: v } as Partial<ReplaceStep>)
            }
            onChange={(_, opt) =>
              typeof opt === "string" &&
              patch({ pattern: swapIfKey(opt) } as Partial<ReplaceStep>)
            }
            renderInput={(p) => (
              <TextField {...p} label="Pattern" size="small" />
            )}
            sx={{ width: 160 }}
          />
          <Autocomplete
            freeSolo
            options={jsonKeys}
            inputValue={(step as ReplaceStep).repl}
            onInputChange={(_, v) => patch({ repl: v } as Partial<ReplaceStep>)}
            onChange={(_, opt) =>
              typeof opt === "string" &&
              patch({ repl: swapIfKey(opt) } as Partial<ReplaceStep>)
            }
            renderInput={(p) => <TextField {...p} label="Repl" size="small" />}
            sx={{ width: 140 }}
          />
          <TextField
            label="Flags"
            size="small"
            value={(step as ReplaceStep).flags ?? "g"}
            onChange={(e) =>
              patch({ flags: e.target.value } as Partial<ReplaceStep>)
            }
            sx={{ width: 60 }}
          />
        </>
      )}

      {/* ── CONCAT ─────────────────────────────────────────────── */}
      {step.kind === "concat" && (
        <>
          <Autocomplete
            freeSolo
            options={jsonKeys}
            inputValue={(step as ConcatStep).prefix ?? ""}
            onInputChange={(_, v) =>
              patch({ prefix: v } as Partial<ConcatStep>)
            }
            onChange={(_, opt) =>
              typeof opt === "string" &&
              patch({ prefix: swapIfKey(opt) } as Partial<ConcatStep>)
            }
            renderInput={(p) => (
              <TextField {...p} label="Prefix" size="small" />
            )}
            sx={{ width: 160 }}
          />
          <Autocomplete
            freeSolo
            options={jsonKeys}
            inputValue={(step as ConcatStep).suffix ?? ""}
            onInputChange={(_, v) =>
              patch({ suffix: v } as Partial<ConcatStep>)
            }
            onChange={(_, opt) =>
              typeof opt === "string" &&
              patch({ suffix: swapIfKey(opt) } as Partial<ConcatStep>)
            }
            renderInput={(p) => (
              <TextField {...p} label="Suffix" size="small" />
            )}
            sx={{ width: 160 }}
          />
        </>
      )}

      <IconButton size="small" onClick={onDelete} sx={{ mt: 0.5 }}>
        <Delete size={16} />
      </IconButton>
    </Stack>
  );
}

/* -------------------------------------------------------------------------- */
/*  4. Dialog                                                                  */
/* -------------------------------------------------------------------------- */
export interface ValueTransformDialogProps {
  open: boolean;
  rawValue: unknown;
  currentValue?: string;
  json?: Record<string, unknown>;
  jsonKeys?: string[];
  initialChain?: TransformChain;
  onClose: () => void;
  onSave: (value: string, chain: TransformChain) => void;
}

export default function ValueTransformDialog({
  open,
  rawValue,
  currentValue,
  json,
  jsonKeys = [],
  initialChain = [],
  onClose,
  onSave,
}: ValueTransformDialogProps) {
  const [chain, setChain] = useState<TransformChain>(initialChain);

  /* reset chain when dialog opens on a *different* row */
  useEffect(() => {
    if (open) setChain(initialChain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Debugging: log when the dialog opens and chain resets. This will only
    // print when window.DEBUG is enabled.
    if (open) {
      debug("ValueTransformDialog/useEffect", "reset chain", initialChain);
    }
  }, [open, initialChain === undefined ? 0 : initialChain.length]);

  const preview = useMemo(
    () => applyTransformChain(chain, rawValue, { json }),
    [chain, rawValue, json]
  );

  const addStep = () => setChain((c) => [...c, { kind: "substr", start: 0 }]);
  const updateStep = (idx: number, s: SingleTransform) =>
    setChain((c) => {
      const next = c.map((step, i) => (i === idx ? s : step));
      debug(
        "ValueTransformDialog/updateStep",
        "updated index",
        idx,
        "with step",
        s,
        "resulting chain",
        next
      );
      return next;
    });
  const deleteStep = (idx: number) =>
    setChain((c) => {
      const next = c.filter((_, i) => i !== idx);
      debug(
        "ValueTransformDialog/deleteStep",
        "deleted index",
        idx,
        "resulting chain",
        next
      );
      return next;
    });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Edit value</DialogTitle>
      <DialogContent dividers>
        <Stack direction="row" spacing={2}>
          <Box flex={1}>
            <Typography variant="caption">Original</Typography>
            <TextField
              fullWidth
              size="small"
              value={String(rawValue ?? "")}
              disabled
            />
          </Box>
          {currentValue !== undefined && (
            <Box flex={1}>
              <Typography variant="caption">Current override</Typography>
              <TextField fullWidth size="small" value={currentValue} disabled />
            </Box>
          )}
          <Box flex={1}>
            <Typography variant="caption">Preview</Typography>
            <TextField fullWidth size="small" value={preview} disabled />
          </Box>
        </Stack>

        <Box mt={3}>
          <Typography variant="subtitle2" gutterBottom>
            Transform chain
          </Typography>
          <Stack spacing={1}>
            {chain.map((step, i) => (
              <StepEditor
                key={i}
                step={step}
                jsonKeys={jsonKeys}
                json={json}
                onChange={(s) => updateStep(i, s)}
                onDelete={() => deleteStep(i)}
              />
            ))}
            <Button
              startIcon={<Plus size={16} />}
              onClick={addStep}
              size="small"
              variant="outlined"
            >
              Add step
            </Button>
          </Stack>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => {
            // Emit debug information just before saving, so that the final
            // preview and chain can be inspected. This does not affect
            // functionality and only logs when debugging is enabled.
            debug(
              "ValueTransformDialog/save",
              "saving value",
              preview,
              "with chain",
              chain
            );
            onSave(preview, chain);
          }}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
