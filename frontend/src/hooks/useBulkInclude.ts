import { useCallback, useRef } from "react";
import type { MappingRow, Override } from "../types/mapping";
import { debug } from "../utils/debug";

export function useBulkInclude(
  currentFile: string | null,
  editCurrentFile: (
    tag: string,
    patch: Override,
    touchTemplate: boolean
  ) => void
) {
  // ⬇️  Track totals for the *last* subset we saw
  const counts = useRef({ on: 0, total: 0 });

  /** Re-compute counters only when the *subset itself* changes */
  const refreshCounts = useCallback((subset: MappingRow[]) => {
    counts.current.total = subset.length;
    counts.current.on = subset.reduce(
      (c, r) =>
        c +
        (r.include ||
        r.category.startsWith("required") ||
        r.category.startsWith("parent")
          ? 1
          : 0),
      0
    );
  }, []);

  /** O(1) – no per-row loops */
  const stateOf = useCallback((): "all" | "some" | "none" => {
    const { on, total } = counts.current;
    return on === 0 ? "none" : on === total ? "all" : "some";
  }, []);

  /** Call this whenever visibleRows (or another subset) changes */
  const onSubsetChange = useCallback(
    (subset: MappingRow[]) => {
      refreshCounts(subset);
    },
    [refreshCounts]
  );

  /** ➌ Toggle *only* the supplied subset. */
  const toggleSubset = useCallback(
    (subset: MappingRow[], checked: boolean) => {
      debug(
        "[useBulkInclude] toggleSubset called for file:",
        currentFile,
        "checked:",
        checked
      );
      if (!currentFile) {
        debug("[useBulkInclude] no currentFile, abort");
        return;
      }
      subset.forEach((r) => {
        if (
          r.category.startsWith("required") ||
          r.category.startsWith("parent")
        ) {
          debug(
            "[useBulkInclude]",
            "  ↳ skipping",
            r.tag,
            "(",
            r.category,
            ")"
          );
          return;
        }
        debug("[useBulkInclude]", "  ↳ toggling", r.tag, "→", checked);
        editCurrentFile(
          r.tag,
          {
            include: checked,
            jsonKey: r.jsonKey,
            value: r.value,
            mode: r.mode,
          } as Override,
          true
        );
      });
      counts.current = {
        total: subset.length,
        on: checked ? subset.length : 0,
      };
    },
    [currentFile, editCurrentFile]
  );

  return { stateOf, toggleSubset, onSubsetChange };
}
