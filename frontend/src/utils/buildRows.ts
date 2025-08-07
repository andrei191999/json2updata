import type { MappingRow } from "../types/mapping";
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

function reuseRow(prev: Map<string, MappingRow>, next: MappingRow): MappingRow {
  const old = prev.get(`${next.tag}::${next.id}`);
  const sameXform =
    (old?.xform?.length || 0) === (next.xform?.length || 0) &&
    JSON.stringify(old?.xform) === JSON.stringify(next.xform);

  return old &&
    old.jsonKey === next.jsonKey &&
    old.value === next.value &&
    old.mode === next.mode &&
    old.include === next.include &&
    sameXform
    ? old // reuse → avoids needless re-renders
    : next; // xform changed → return fresh object
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

  // Helper: push a row keeping everything uniform
  const push = (r: Partial<MappingRow>) => {
    /* ① determine the definitive category once */
    const category =
      r.category ??
      categoriseRow(
        r.tag!,
        r.jsonKey ?? "",
        required,
        conditional,
        parentReq,
        parentOpt,
        warnMissing
      );

    /* ② mandatory rows are *always* included unless the user
          explicitly disabled them via overrides */
    const includeDefault =
      r.include ?? (category === "required" || category === "parent-required");

    rows.push(
      reuseRow(prevMap, {
        id: r.id ?? orderMap[r.tag!] ?? Number.MAX_SAFE_INTEGER,
        tag: r.tag!, // ← always set
        jsonKey: r.jsonKey ?? "",
        include: includeDefault,
        value: r.value ?? "",
        touched: r.touched ?? false,
        category,
        warning: r.warning,
        mode: r.mode ?? "real",
        xform: r.xform,
      })
    );
  };

  // ─── Loop over every canonical tag in CSV order ─────────────────────────
  tagList.forEach((tag) => {
    // ⛔️ nothing to show?  jump to next tag
    const ov = overrides?.[tag];

    // 1) user override → wins
    if (ov) {
      const warning = ov.mode === "pick" && !(ov.jsonKey in json);
      /* raw before transform */
      const raw =
        ov.mode === "hard" ? ov.value : String(json[ov.jsonKey] ?? "");

      /* final value shown in the grid */
      const final =
        ov.xform && ov.xform.length
          ? applyTransformChain(ov.xform, raw, { json })
          : raw;

      push({
        tag,
        jsonKey: ov.jsonKey,
        include: ov.include,
        value: final,
        touched: true,
        warning: warning ? true : false,
        mode: ov.mode,
        xform: ov.xform, // ★ expose to the grid
      });
      return;
    }

    // 2) parent rows
    if (parentReq.has(tag)) {
      push({
        tag,
        include: true,
        jsonKey: "",
        value: "",
        mode: "real",
        category: "parent-required",
      });
      return;
    }
    if (parentOpt.has(tag)) {
      push({
        tag,
        include: false,
        jsonKey: "",
        value: "",
        mode: "real",
        category: "parent-optional",
      });
      return;
    }

    // 3) untouched tag → backend top suggestion / hard default
    const top = backendSuggest[tag]?.[0];
    if (top) {
      push({
        tag,
        jsonKey: top[0],
        value: String(json[top[0]] ?? ""),
        mode: "real",
      });
    } else if (backendMapped[tag] !== undefined) {
      push({
        tag,
        jsonKey: "__hard__",
        value: String(backendMapped[tag]),
        mode: "hard",
      });
    } else {
      push({ tag }); // empty row
    }
  });

  /* ─── Clone the real DocumentReference row into an alias on top ─── */
  {
    const idx = rows.findIndex(
      (r) => r.tag === "DocumentReferences.DocumentReference"
    );
    if (idx !== -1) {
      const base = rows[idx];
      const alias: MappingRow = {
        ...base,
        id: base.id - 0.001, // always sorts right before canonical row
        category: "filename", // drives “first row” in the sorter
        label: "Output filename (PDF)",
      };
      rows.unshift(alias); // put at absolute top
    }
  }

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
      })
    );
  }

  // Final sort by id (mostly already sorted, but meta rows may shift)
  // Final sort – filename row first, then by id
  const sorted = rows.sort((a, b) => {
    if (a.category === "filename" && b.category !== "filename") return -1;
    if (b.category === "filename" && a.category !== "filename") return 1;
    return a.id - b.id;
  });
  debug("buildRows", "rows changed:", sorted.length - prevMap.size);
  return sorted;
}
