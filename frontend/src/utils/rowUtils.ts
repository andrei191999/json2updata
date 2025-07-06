import type { GridRowParams, GridValueGetter } from "@mui/x-data-grid";
import type { MappingRow } from "../types/mapping";
import type { Cat } from "../components/CategoryFilterSelect";
import { debug } from "./debug"; // same folder → “./debug”

/* Human-readable mapping for tooltip text */
export const catName: Record<Cat, string> = {
  M: "Required",
  C: "Conditional",
  O: "Optional",
  P: "Parent",
};

/* Cheap helper → M / C / O / P code used by the Cat column */
export const catGetter: GridValueGetter<MappingRow, Cat> = (_v, row) => {
  if (row.category.startsWith("required")) return "M";
  if (row.category.startsWith("conditional")) return "C";
  if (row.category.startsWith("parent")) return "P";
  return "O";
};

/* Row CSS class — used by DataGrid “getRowClassName” prop */
export function getRowClassName(p: GridRowParams<MappingRow>): string {
  if (p.row.category === "filename") return "row-filename";
  const warn = p.row.warning ? " row-warning" : "";
  return `row-${p.row.category}${warn}`;
}

debug("[rowUtils] module initialised");
