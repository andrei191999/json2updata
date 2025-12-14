import { Autocomplete, TextField } from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import type { MappingRow, Override } from "../../types/mapping";

interface Props extends GridRenderCellParams<any, MappingRow> {
  jsonKeys: string[];
  tagList: string[];
  json: Record<string, unknown>;
  onEdit: (
    tag: string,
    patch: Partial<Override>,
    touchTemplate?: boolean
  ) => void;
}

function ValueCell({ row, jsonKeys, tagList, json, onEdit, api }: Props) {
  const tag = row.tag;

  // --- Render the correct editor based on the row's mode ---

  // Mode 1: Awaiting selection of an Updata Tag to alias
  if (row.mode === "alias") {
    return (
      <Autocomplete
        options={(tagList || []).filter((t) => t !== tag)}
        value={row.aliasFor || null}
        size="small"
        fullWidth
        autoFocus
        open
        onChange={(_, newAliasTag) => {
          if (newAliasTag) {
            onEdit(tag, { mode: "alias", aliasFor: newAliasTag }, true);
            api.stopCellEditMode({ id: row.id, field: "value" });
          }
        }}
        renderInput={(params) => (
          <TextField {...params} label="Select an output field" />
        )}
      />
    );
  }

  // Mode 2: Awaiting selection of a JSON input key
  if (row.mode === "pick") {
    return (
      <Autocomplete
        options={jsonKeys}
        value={row.jsonKey || null}
        size="small"
        fullWidth
        autoFocus
        open
        onChange={(_, newJsonKey) => {
          if (newJsonKey) {
            onEdit(tag, { mode: "real", jsonKey: newJsonKey }, true);
            api.stopCellEditMode({ id: row.id, field: "value" });
          }
        }}
        renderInput={(params) => (
          <TextField {...params} label="Select an input field" />
        )}
      />
    );
  }

  // Mode 3: Awaiting a hard-coded value
  if (row.mode === "hard") {
    return (
      <TextField
        value={row.value}
        onChange={(e) => onEdit(tag, { mode: "hard", value: e.target.value })}
        onBlur={() => api.stopCellEditMode({ id: row.id, field: "value" })}
        size="small"
        fullWidth
        autoFocus
      />
    );
  }

  // Default ("real" mode): Just display the final value, not editable.
  return <span>{row.value}</span>;
}

export default ValueCell; // No need for memo, it's an interactive cell
