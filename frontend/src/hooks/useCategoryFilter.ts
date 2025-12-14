import { useMemo } from "react";
import type { MappingRow } from "../types/mapping";
import { catGetter } from "../utils/rowUtils";

export function useCategoryFilter(
  rows: MappingRow[],
  selected: string[]
): MappingRow[] {
  return useMemo(() => {
    // If no categories are selected, show all rows.
    if (selected.length === 0) {
      return rows;
    }

    const selectedSet = new Set(selected);
    const filtered = rows.filter((row) =>
      selectedSet.has(catGetter(null, row))
    );

    return filtered;
  }, [rows, selected]);
}
