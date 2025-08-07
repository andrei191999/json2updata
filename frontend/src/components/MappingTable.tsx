import { DataGrid } from "@mui/x-data-grid";
import { Box, CircularProgress } from "@mui/material";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { collectJsonKeys } from "../utils/jsonKeys";
import { useCategoryFilter } from "../hooks/useCategoryFilter";
import { useBulkInclude } from "../hooks/useBulkInclude";

import { buildColumns } from "../utils/buildColumns";
import { getRowClassName } from "../utils/rowUtils";

import type { MappingRow, Override } from "../types/mapping";
import ValueTransformDialog from "./ValueTransformDialog";
import type { Cat } from "./CategoryFilterSelect";
import type { TransformChain } from "../components/ValueTransformDialog";

interface Props {
  rows: MappingRow[];
  currentFile: string | null;
  loading: boolean;
  suggest: Record<string, Array<[string, number]>>;
  json: Record<string, unknown>;
  onEdit: (tag: string, patch: Override, touchTemplate?: boolean) => void;
}

/**
 * Presentational grid – no hidden state except the cat-filter dropdown.
 */
function MappingTableBase({
  rows,
  currentFile,
  loading,
  suggest,
  json,
  onEdit,
}: Props) {
  /* ─── JSON keys memo ─────────────────────────────────────────────── */
  const jsonKeys = useMemo(() => collectJsonKeys(json), [json]);

  /* ─── Category filter (M/C/O/P) ──────────────────────────────────── */
  const [selectedCats, setSelectedCats] = useState<Cat[]>([]);
  const visibleRows = useCategoryFilter(rows, selectedCats);

  /* ─── Bulk include / exclude for the *visible* subset ────────────── */
  const { stateOf, toggleSubset, onSubsetChange } = useBulkInclude(
    currentFile,
    onEdit
  );

  /* tell the hook whenever the visible set changes ------------------- */
  useEffect(() => {
    onSubsetChange(visibleRows);
  }, [visibleRows, onSubsetChange]);

  const includeState = stateOf();

  /* ── overlay state ───────────────────────────────────────────── */
  const [editing, setEditing] = useState<{
    row: MappingRow;
    raw: unknown;
    chain: TransformChain;
  } | null>(null);

  const handleSave = (final: string, chain: TransformChain) => {
    const r = editing!.row;

    onEdit(
      r.tag,
      {
        jsonKey: r.jsonKey, // keep whatever key was mapped
        include: true, // ✔ auto-enable
        mode: r.mode ?? "pick", // keep prior behaviour (NOT "hard")
        value: final, // preview value (helps diffing)
        xform: chain, // ★ the real magic
        // touched: true,
      },
      true // touchTemplate? – keep your old flag
    );

    setEditing(null);
  };

  const openEditor = useCallback(
    (row: MappingRow) => {
      const raw = row.jsonKey && json ? (json as any)[row.jsonKey] : row.value;
      const chain = (row as any).xform ?? []; // ★ reuse previous edits
      setEditing({ row, raw, chain });
    },
    [json]
  );

  /* ─── Column definitions (pure, memoised) ───────────────────────── */
  const columns = useMemo(
    () =>
      buildColumns({
        selectedCats,
        setSelectedCats,
        includeState,
        toggleSubset,
        json,
        jsonKeys,
        suggest,
        onEdit,
        visibleRows,
        openEditor,
      }),
    [
      selectedCats,
      includeState,
      toggleSubset,
      json,
      jsonKeys,
      suggest,
      onEdit,
      visibleRows,
      openEditor,
    ]
  );

  /* ─── Loading splash ─────────────────────────────────────────────── */
  if (loading) {
    return (
      <Box sx={{ display: "flex", p: 4, justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  /* ─── The DataGrid itself ───────────────────────────────────────── */
  return (
    <Box sx={{ height: "100%", width: "100%", overflow: "auto" }}>
      <DataGrid
        rows={visibleRows}
        columns={columns}
        getRowId={(r: MappingRow) => `${r.tag}::${r.id}`}
        editMode="cell"
        density="compact"
        sx={{ height: "100%", width: "100%" }}
        getRowClassName={getRowClassName as (params: any) => string}
      />

      {editing && (
        <ValueTransformDialog
          open
          rawValue={editing.raw}
          currentValue={editing.row.value}
          json={json}
          jsonKeys={jsonKeys}
          initialChain={editing.chain}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </Box>
  );
}

export default memo(MappingTableBase);
