import React from "react";
import { Select, MenuItem, ListSubheader } from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import type { Override } from "../../types/mapping";

interface Props extends GridRenderCellParams {
  suggest: Record<string, [string, number][]>;
  jsonKeys: string[];
  json: Record<string, unknown>;
  onEdit: (tag: string, patch: Override) => void;
}

function JsonFieldEditCell({ row, value, suggest, json, onEdit }: Props) {
  const tag = row.tag as string;
  const top3 = (suggest[tag] || []).slice(0, 3);
  const currentKey = row.jsonKey as string;
  const menuItems: React.ReactNode[] = [];

  if (
    row.category === "parent-required" ||
    row.category === "parent-optional"
  ) {
    return null; // render empty cell
  }

  if (
    currentKey &&
    !["__hard__", "__pick__", ""].includes(currentKey) &&
    !top3.some(([k]) => k === currentKey)
  ) {
    menuItems.push(
      <ListSubheader key="hdr-current">Current</ListSubheader>,
      <MenuItem key={currentKey} value={currentKey}>
        {currentKey}
      </MenuItem>
    );
  }

  menuItems.push(<ListSubheader key="hdr-suggest">Suggestions</ListSubheader>);
  top3.forEach(([k, score]) =>
    menuItems.push(
      <MenuItem key={k} value={k}>
        {k} ({score}%)
      </MenuItem>
    )
  );

  menuItems.push(
    <ListSubheader key="hdr-override">Overrides</ListSubheader>,
    <MenuItem key="__hard__" value="__hard__">
      Hard-code…
    </MenuItem>,
    <MenuItem key="__pick__" value="__pick__">
      Pick from input…
    </MenuItem>
  );

  return (
    <Select
      value={row.jsonKey || ""}
      size="small"
      sx={{ minWidth: 200 }}
      onChange={(e) => {
        const sel = e.target.value as string;
        const mode =
          sel === "__hard__" ? "hard" : sel === "__pick__" ? "pick" : "real";

        if ((window as any).APP_DEBUG) {
          console.debug(
            `[JsonFieldEditCell] tag=${tag} selecting jsonKey=${sel}, mode=${mode}`
          );
        }

        if (sel === "__hard__") {
          onEdit(tag, {
            jsonKey: "__hard__",
            mode: "hard",
            include: true,
            value: "",
          });
        } else if (sel === "__pick__") {
          onEdit(tag, {
            jsonKey: "__pick__",
            mode: "pick",
            include: true,
            value: "",
          });
        } else {
          // a real suggestion
          onEdit(tag, {
            jsonKey: sel,
            mode: "real",
            include: true,
            value: String((json as any)[sel] ?? ""),
          });
        }
      }}
    >
      {menuItems}
    </Select>
  );
}

/* ----  Memoise so unchanged rows don’t re-render -------------------- */
function areEqual(prev: Props, next: Props) {
  return (
    prev.row.jsonKey === next.row.jsonKey &&
    prev.row.mode === next.row.mode &&
    prev.row.value === next.row.value
  );
}

export default React.memo(JsonFieldEditCell, areEqual);
