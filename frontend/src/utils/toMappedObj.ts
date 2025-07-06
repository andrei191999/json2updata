import type { MappingRow } from "../types/mapping";

export function toMappedObj(rows: MappingRow[]) {
  const out: Record<string, unknown> = {};
  rows
    .filter((r) => r.include && !r.tag.startsWith("+"))
    .forEach((r) => {
      out[r.tag] = r.value;
    });
  return out;
}
