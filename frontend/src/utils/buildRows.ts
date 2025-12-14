import type { MappingRow, RowMode } from "../types/mapping";
import type { Override } from "../types/mapping";
import { categoriseRow } from "./categoriseRow";
import { debug } from "./debug";
import { applyTransformChain } from "../components/ValueTransformDialog";

/**
 * Pure function: given JSON + backend guesses + user overrides,
 * return the full, sorted rows[] array expected by the table.
 *
 * No React, no side effects, no setState – so it’s VERY easy to test.
 */
interface Params {
  json: Record<string, unknown>;
  backendMapped: Record<string, unknown>;
  backendSuggest: Record<string, Array<[string, number]>>;
  overrides: Record<string, Override>;
  tagList: string[]; // full CSV order
  orderMap: Record<string, number>; // tag → index
  required: Set<string>;
  conditional: Set<string>;
  parentReq: Set<string>;
  parentOpt: Set<string>;
  warnMissing?: boolean; // show ⚠️ when jsonKey ≠ "" but missing in the current JSON
}

// A simple memoization helper to prevent needless re-renders of unchanged rows.
function reuseRow(prev: Map<string, MappingRow>, next: MappingRow): MappingRow {
  const old = prev.get(`${next.tag}::${next.id}`);
  const isUnchanged =
    old &&
    old.jsonKey === next.jsonKey &&
    old.value === next.value &&
    old.mode === next.mode &&
    old.include === next.include &&
    old.aliasFor === next.aliasFor &&
    JSON.stringify(old.xform) === JSON.stringify(next.xform);

  return isUnchanged ? old : next;
}

export function buildRows(
  prevRows: MappingRow[] | undefined,
  {
    json,
    backendMapped,
    backendSuggest,
    overrides,
    tagList,
    orderMap,
    required,
    conditional,
    parentReq,
    parentOpt,
    warnMissing = false,
  }: Params
): MappingRow[] {
  const prevMap = new Map(prevRows?.map((r) => [`${r.tag}::${r.id}`, r]));
  const rows: MappingRow[] = [];

  debug("buildRows", "REBUILD");

  // --- Main loop to build all standard Updata rows ---
  tagList.forEach((tag) => {
    const ov = overrides[tag];
    const isParent = parentReq.has(tag) || parentOpt.has(tag);

    // Step 1: Determine the row's complete state from a clear priority list.
    let mode: RowMode = "real";
    let jsonKey = "";
    let value = "";
    let include = false;
    let xform = ov?.xform;
    let touched = false;

    if (ov) {
      // Priority 1: A user override exists.
      touched = true;
      mode = ov.mode;
      jsonKey = ov.jsonKey;
      include = ov.include;
      const rawValue = mode === "hard" ? ov.value : String(json[jsonKey] ?? "");
      value = xform ? applyTransformChain(xform, rawValue, { json }) : rawValue;
    } else if (isParent) {
      // Priority 2: It's a parent tag.
      include = parentReq.has(tag); // Include if it's a required parent
    } else {
      // Priority 3: Use backend suggestions or defaults.
      const topSuggestion = backendSuggest[tag]?.[0]?.[0];
      if (topSuggestion) {
        jsonKey = topSuggestion;
        value = String(json[jsonKey] ?? "");
      } else if (backendMapped[tag] !== undefined) {
        mode = "hard";
        value = String(backendMapped[tag]);
      }
    }

    // Step 2: Determine the category based on the resolved state.
    // This was a critical piece of missing logic.
    const category = categoriseRow(
      tag,
      jsonKey,
      required,
      conditional,
      parentReq,
      parentOpt,
      warnMissing
    );
    const warning = !!(mode !== "hard" && jsonKey && !(jsonKey in json));

    // Step 3: Set default inclusion if no override exists.
    if (!ov) {
      include = category === "required" || category === "parent-required";
    }

    // Step 4: Create the final row object.
    const newRow: MappingRow = {
      id: orderMap[tag] ?? Number.MAX_SAFE_INTEGER,
      tag,
      depth: tag.split(".").length - 1,
      mode,
      jsonKey,
      value,
      include,
      xform,
      touched,
      warning,
      category,
      preview: "", // preview is not used, can be removed if desired
    };
    rows.push(reuseRow(prevMap, newRow));
  });

  const pdfNameOverride = overrides["_pdf_name"];

  let initialMode: RowMode = "alias"; // Default to aliasing the DocumentReference
  let initialJsonKey = "__alias__";
  let initialValue = "";
  let initialAliasFor = "DocumentReferences.DocumentReference";

  if (pdfNameOverride) {
    // If an override exists, it dictates our state.
    initialMode = pdfNameOverride.mode;
    initialAliasFor = pdfNameOverride.aliasFor ?? "";
    initialJsonKey = pdfNameOverride.jsonKey;

    if (pdfNameOverride.mode === "alias" && initialAliasFor) {
      const sourceRow = rows.find((r) => r.tag === initialAliasFor);
      initialValue = sourceRow?.value ?? "[Alias not found]";
    } else if (pdfNameOverride.mode === "real" && initialJsonKey) {
      initialValue = String(json[initialJsonKey] ?? "");
    } else {
      // mode === 'hard'
      initialValue = pdfNameOverride.value;
    }
  } else {
    // Default behavior: The filename is an alias of DocumentReference.
    const docRefRow = rows.find(
      (r) => r.tag === "DocumentReferences.DocumentReference"
    );
    initialValue = docRefRow?.value ?? "";
  }

  const filenameRow: MappingRow = {
    id: -1, // Sorts to the top
    tag: "_pdf_name",
    label: "Output filename (PDF)",
    category: "filename",
    jsonKey: initialJsonKey,
    mode: initialMode,
    value: sanitizeStem(initialValue),
    aliasFor: initialAliasFor,
    include: true,
    touched: !!pdfNameOverride,
    preview: "",
    warning: false,
  };
  rows.push(reuseRow(prevMap, filenameRow));

  // ─── Insert phantom “+ Add metadata (Document)” row ───────────────
  if (!rows.some((r) => r.tag.startsWith("+  Add metadata"))) {
    const lastDoc = [...rows]
      .reverse()
      .find((r) => r.tag.startsWith("Document."));
    const baseId = lastDoc?.id ?? (rows.length ? rows[rows.length - 1].id : 0);

    rows.push(
      reuseRow(prevMap, {
        id: baseId + 0.001,
        tag: "+  Add metadata (Document)",
        jsonKey: "",
        include: true,
        value: "",
        touched: false,
        category: "parent-optional",
        warning: false,
        preview: "",
      })
    );
  }

  // Final sort – filename row first, then by id
  const sorted = rows.sort((a, b) => {
    const idA = a.id ?? Number.MAX_SAFE_INTEGER;
    const idB = b.id ?? Number.MAX_SAFE_INTEGER;
    return idA - idB;
  });

  // For debugging: you can temporarily uncomment this to see the generated IDs.
  // if (sorted.length > 0 && prevRows?.length === 0) {
  //   console.log("Generated row IDs:", sorted.map(r => ({ tag: r.tag, id: r.id })));
  // }

  debug("buildRows", "rows changed:", sorted.length - prevMap.size);
  return sorted;
}
// Helper to sanitize the filename
const sanitizeStem = (value: unknown): string => {
  const str = String(value ?? "");
  if (str.toLowerCase().endsWith(".pdf")) {
    return str.slice(0, -4);
  }
  return str;
};
