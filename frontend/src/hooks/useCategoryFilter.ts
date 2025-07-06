import { useMemo, useRef } from "react";
import type { MappingRow } from "../types/mapping";
import type { Cat } from "../components/CategoryFilterSelect";

/* helper: category → single-letter code */
export const codeOf = (cat: string | undefined): Cat => {
  if (!cat) return "O";
  if (cat.startsWith("required")) return "M";
  if (cat.startsWith("conditional")) return "C";
  if (cat.startsWith("parent")) return "P";
  return "O";
};

export function useCategoryFilter(
  rows: MappingRow[],
  selected: string[]
): MappingRow[] {
  // keep a ref to the last value we returned
  const prevRef = useRef<MappingRow[]>(rows);

  return useMemo(() => {
    // no filter → just return the original array *unless* it changed
    if (selected.length === 0) {
      if (prevRef.current === rows) return prevRef.current;
      prevRef.current = rows;
      return rows;
    }

    // filtered view
    const set = new Set(selected);
    const filtered = rows.filter((r) => set.has(r.category));
    // store for next render
    prevRef.current = filtered;
    return filtered;
  }, [rows, selected]);
}
