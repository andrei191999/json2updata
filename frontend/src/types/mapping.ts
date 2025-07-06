// Central place for all mapping-related types

export type RowCategory =
  | "filename"
  | "required" // Y
  | "conditional" // Y?
  | "guessed" // autofill
  | "optional" // still empty
  | "parent-required" // parent with required tags
  | "parent-optional"; // parent with optional tags

export interface MappingRow {
  /** stable row id = CSV order; meta rows use fractional ids (89.001, 89.002, …) */
  id: number;
  /** canonical Updata tag, or "meta:doc:foo", or "+  Add metadata (Document)" */
  tag: string;
  label?: string;
  /** "", "__pick__", "__hard__", or an actual JSON key */
  jsonKey: string;
  /** whether to include this tag when building XML */
  include: boolean;
  /** literal value that will end up in XML (stringified) */
  value: string;
  /** user changed *any* field in this row at least once */
  touched: boolean;
  /** show ⚠️ when jsonKey ≠ "" but missing in the current JSON */
  warning: boolean | undefined;
  category: RowCategory;
  mode?: "pick" | "hard" | "real";
}

/** what we store in mappingCache[fileName] */
export interface Override {
  jsonKey: string;
  value: string;
  include: boolean;
  /** "pick" | "hard" | "real"  (how jsonKey was chosen) */
  mode: "pick" | "hard" | "real";
}

/** mappingCache = { [fileName]: { [updataTag]: Override } } */
export type MappingCache = Record<string, Record<string, Override>>;
