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

  for (const row of rows) {
    /* skip meta / parent rows */
    if (row.tag.startsWith("+") || row.category.startsWith("parent-")) continue;
    if (!row.include) continue;

    if (row.tag === "_pdf_name") {
      let v = String(row.value ?? "").trim();
      if (v) {
        // normalize: keep stem or allow .pdf, both OK in backend
        v = v.replace(/[\\/:*?"<>|]+/g, "_").trim();
        mapped["_pdf_name"] = v; // backend will add .pdf if missing
      }
      continue; // don't write into DocumentReference
    }

    const val = pickValue(row.value);
    if (val === null || val === "") continue; // nothing to emit

    if (row.warning) warnings.push(row.tag);
    mapped[row.tag] = val;
  }

  debug("applyMapping", "done →", mapped, warnings.length && "⚠", warnings);
  return { mapped, warnings };
}
