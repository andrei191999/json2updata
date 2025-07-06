/**
 * utils/applyMapping.ts
 * ------------------------------------------------------------
 * Convert the rows coming from <MappingTable/> into the plain
 * `{ [updataTag]: value }` object expected by the backend /build
 * endpoint.  100 % side-effect-free.
 */

import type { MappingRow } from "../types/mapping";
import { debug } from "./debug";

export interface ApplyResult {
  /** final object sent to /build */
  mapped: Record<string, unknown>;
  /** any rows that were flagged with `warning: true` */
  warnings: string[];
}

/** primitive we actually want in the XML */
function pickValue(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    // cell helper-object → dig out the real value
    // eslint-disable-next-line  @typescript-eslint/no-explicit-any
    return (v as any).value ?? null;
  }
  return v as string | number | boolean;
}

export function applyMapping(rows: MappingRow[]) {
  const mapped: Record<string, unknown> = {};
  const warnings: string[] = [];

  for (const r of rows) {
    /* skip meta / parent rows */
    if (r.tag.startsWith("+") || r.category.startsWith("parent-")) continue;
    if (!r.include) continue;

    const val = pickValue(r.value);
    if (val === null || val === "") continue; // nothing to emit

    if (r.warning) warnings.push(r.tag);
    mapped[r.tag] = val;
  }

  debug("applyMapping", "done →", mapped, warnings.length && "⚠", warnings);
  return { mapped, warnings };
}
