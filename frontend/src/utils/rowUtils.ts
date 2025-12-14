import type { GridRowClassNameParams } from "@mui/x-data-grid";
import type { MappingRow } from "../types/mapping";
import type { Cat } from "../components/CategoryFilterSelect";

/**
 * Human-readable mapping for tooltip text.
 */
export const catName: Record<Cat, string> = {
  M: "Mandatory",
  C: "Conditional",
  P: "Parent / Structural",
  O: "Optional / Guessed",
};

/**
 * Determines the category code (M/C/P/O) for a given row.
 * This version uses the older (value, row) signature but with corrected logic.
 */
export const catGetter = (_value: any, row: MappingRow): Cat => {
  const category = row.category;

  if (!category) return "O";

  if (category === "required" || category === "parent-required") {
    return "M";
  }
  if (category === "conditional") {
    return "C";
  }
  if (category === "parent-optional" || category === "filename") {
    return "P";
  }
  return "O";
};

/**
 * Applies a specific CSS class to a row based on its properties.
 */
export function getRowClassName(
  params: GridRowClassNameParams<MappingRow>
): string {
  const row = params.row;
  const classNames = [`row-${row.category}`]; // Base class like "row-required"

  if (row.touched) {
    classNames.push("row-touched");
  }
  if (row.warning) {
    classNames.push("row-warning");
  }

  return classNames.join(" "); // e.g., "row-required row-touched"
}
