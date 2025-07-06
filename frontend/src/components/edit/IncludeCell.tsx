import React from "react";
import { Checkbox } from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import type { Override } from "../../types/mapping";

interface Props extends GridRenderCellParams {
  onEdit: (tag: string, patch: Override, touchTemplate: boolean) => void;
}

function IncludeCell({ row, onEdit }: Props) {
  const disabled =
    row.category === "required" ||
    row.category === "parent-required" ||
    row.category === "parent-optional";
  return (
    <Checkbox
      size="small"
      checked={row.include}
      disabled={disabled}
      onChange={(e) =>
        onEdit(
          row.tag,
          {
            jsonKey: row.jsonKey,
            value: row.value,
            mode: row.mode,
            include: e.target.checked,
          },
          true
        )
      }
    />
  );
}

export default React.memo(IncludeCell);
