import React from "react";
import { Autocomplete, TextField } from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import type { Override } from "../../types/mapping";

interface Props extends GridRenderCellParams {
  jsonKeys: string[];
  json: Record<string, unknown>;
  onEdit: (tag: string, patch: Override) => void;
}

function ValueCell({ row, jsonKeys, json, onEdit }: Props) {
  if ((window as any).APP_DEBUG) {
    console.debug(
      `[ValueCell] tag=${row.tag} mode=${row.mode} jsonKey=${row.jsonKey} value=${row.value}`
    );
  }

  if (row.category === "group-required" || row.category === "group-optional") {
    return null; // render empty cell
  }

  const tag = row.tag as string;

  /* ---------- Hard-coded mode → plain input ----------------------------- */
  if (row.mode === "hard") {
    return (
      <TextField
        value={row.value}
        size="small"
        sx={{ minWidth: 180 }}
        onChange={(e) =>
          onEdit(tag, {
            jsonKey: "__hard__",
            mode: "hard",
            include: true,
            value: e.target.value,
          })
        }
      />
    );
  }

  /* ---------- Pick mode → full autocomplete ---------------------------- */
  if (row.mode === "pick") {
    return (
      <Autocomplete
        options={jsonKeys}
        size="small"
        sx={{ minWidth: 180 }}
        value={row.jsonKey || null}
        onChange={(_, key) =>
          key &&
          onEdit(tag, {
            jsonKey: key,
            include: true,
            mode: "real",
            value: key in json ? String((json as any)[key]) : "",
          })
        }
        renderInput={(p) => <TextField {...p} />}
      />
    );
  }

  /* ---------- Default (read-only) -------------------------------------- */
  return <span>{row.value}</span>;
}

/* ----  Memoise so unchanged rows don’t re-render -------------------- */
function areEqual(prev: Props, next: Props) {
  return (
    prev.row.jsonKey === next.row.jsonKey &&
    prev.row.mode === next.row.mode &&
    prev.row.value === next.row.value
  );
}

export default React.memo(ValueCell, areEqual);
