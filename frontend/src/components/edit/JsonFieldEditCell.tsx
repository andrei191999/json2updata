import React from "react";
import { Select, MenuItem, ListSubheader } from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import type { MappingRow, Override } from "../../types/mapping";

// This component is now an EDITOR, used only when a cell is in edit mode.
interface Props extends GridRenderCellParams<any, MappingRow> {
  suggest: Record<string, [string, number][]>;
  onEdit: (
    tag: string,
    patch: Partial<Override>,
    touchTemplate?: boolean
  ) => void;
}

function JsonFieldEditCell({ row, onEdit, suggest, api }: Props) {
  const handleChange = (event: any) => {
    const selected = event.target.value as string;

    if (selected === "__alias_mode__") {
      // Set mode to "alias" and clear specific keys.
      // The ValueCell will now show the alias Autocomplete.
      onEdit(row.tag, { mode: "alias", jsonKey: "", aliasFor: "" }, true);
    } else if (selected === "__hard__") {
      onEdit(row.tag, { mode: "hard", jsonKey: "" }, true);
    } else if (selected === "__pick__") {
      onEdit(row.tag, { mode: "pick", jsonKey: "" }, true);
    } else {
      // A real JSON key was selected from suggestions
      onEdit(row.tag, { mode: "real", jsonKey: selected }, true);
      // We're done, so stop editing this cell.
      api.stopCellEditMode({ id: row.id, field: "jsonKey" });
    }
  };

  const top3 = suggest[row.tag]?.slice(0, 3) || [];

  return (
    <Select
      value={row.jsonKey || "__pick__"} // Default to "pick" to show the picker
      onChange={handleChange}
      size="small"
      fullWidth
      autoFocus
      open
    >
      <ListSubheader>Actions</ListSubheader>
      <MenuItem value="__hard__">Hard-code value...</MenuItem>
      <MenuItem value="__pick__">Pick from JSON input...</MenuItem>
      {/* Only show alias option for the special filename row */}
      {row.tag === "_pdf_name" && (
        <MenuItem value="__alias_mode__">Alias from another field...</MenuItem>
      )}

      {top3.length > 0 && <ListSubheader>Suggestions</ListSubheader>}
      {top3.map(([key]) => (
        <MenuItem key={key} value={key}>
          {key}
        </MenuItem>
      ))}
    </Select>
  );
}

export default JsonFieldEditCell; // No need for memo on an edit component
