export function useBulkInclude(
  currentFile: string | null,
  edit: (
    file: string,
    tag: string,
    patch: Override,
    touchTemplate: boolean
  ) => void
) {
  /** ➋ Given *any* subset of rows, tell the caller whether every row
      is ticked, none is ticked, or there’s a mix. */
  const stateOf = useCallback(
    (subset: MappingRow[]): "all" | "some" | "none" => {
      const all = subset.every(
        (r) => r.include || r.category.startsWith("required")
      );
      const none = subset.every(
        (r) => !r.include && !r.category.startsWith("required")
      );
      return all ? "all" : none ? "none" : "some";
    },
    []
  );

  /** ➌ Toggle *only* the supplied subset. */
  const toggleSubset = useCallback(
    (subset: MappingRow[], checked: boolean) => {
      if (!currentFile) return;
      subset.forEach((r) => {
        if (
          r.category.startsWith("required") ||
          r.category.startsWith("parent")
        )
          return;
        edit(
          currentFile,
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
    },
    [currentFile, edit]
  );

  return { stateOf, toggleSubset };
}
