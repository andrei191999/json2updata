import { useState, useCallback } from "react";
import type { MappingCache } from "../types/mapping";
import type { Override } from "../types/mapping";

/**
 * Reusable hook that owns the { file → overrides } dictionary.
 * Components never touch useState directly – they call edit() / clear() helpers.
 */
export function useMappingCache() {
  const [cache, setCache] = useState<MappingCache>({});

  /** merge a single override patch into cache[file][tag] */
  const edit = useCallback(
    (file: string, tag: string, patch: Override, touchTemplate = false) =>
      setCache((prev) => {
        const next: MappingCache = {
          ...prev,
          [file]: { ...prev[file], [tag]: patch },
        };
        if (touchTemplate) {
          next.__template__ = {
            ...(prev.__template__ ?? {}),
            [tag]: patch,
          };
        }
        return next;
      }),
    []
  );

  /** when we open a new file with “keep mappings” ON */
  const hydrateFile = useCallback(
    (file: string) =>
      setCache((prev) => ({
        ...prev,
        [file]: { ...(prev[file] ?? {}), ...(prev.__template__ ?? {}) },
      })),
    []
  );

  /** forget everything for a given file (used when keepMappings = false) */
  const clearFile = useCallback(
    (file: string) =>
      setCache((prev) => {
        const { [file]: _, ...rest } = prev;
        return rest;
      }),
    []
  );

  /** wipe only the template */
  const resetTemplate = useCallback(
    () =>
      setCache((prev) => {
        const { __template__, ...rest } = prev;
        return rest; //  ← template removed, file overrides kept
      }),
    []
  );

  /** wipe everything (called when the folder changes) */
  const clearOvs = useCallback(() => setCache({}), []);

  return { cache, edit, clearFile, hydrateFile, resetTemplate, clearOvs };
}
