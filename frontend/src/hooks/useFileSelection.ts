import { useState, useCallback } from "react";

/** centralised selection state for the left pane */
export function useFileSelection() {
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = useCallback((fname: string, checked: boolean) => {
    setSelected((prev) =>
      checked ? [...prev, fname] : prev.filter((f) => f !== fname)
    );
  }, []);

  const selectAll = useCallback((all: string[]) => setSelected(all), []);
  const clearAll = useCallback(() => setSelected([]), []);

  return { selected, toggle, selectAll, clearAll };
}
