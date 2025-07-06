import type { RowCategory } from "../types/mapping";

export function categoriseRow(
  tag: string,
  jsonKey: string,
  required: Set<string>,
  conditional: Set<string>,
  parentReq: Set<string>,
  parentOpt: Set<string>,
  warnMissing: boolean
): RowCategory {
  if (parentReq.has(tag)) return "parent-required";
  if (parentOpt.has(tag)) return "parent-optional";
  if (required.has(tag)) return "required";
  if (conditional.has(tag)) return "conditional";
  if (jsonKey) return "guessed";
  return "optional";
}
