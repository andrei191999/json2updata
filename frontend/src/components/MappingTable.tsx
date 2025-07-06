import { DataGrid } from "@mui/x-data-grid";
import { Box, CircularProgress } from "@mui/material";
import { memo, useEffect, useMemo, useState } from "react";

import { collectJsonKeys } from "../utils/jsonKeys";
import { useCategoryFilter } from "../hooks/useCategoryFilter";
import { useBulkInclude } from "../hooks/useBulkInclude";

import { buildColumns } from "../utils/buildColumns";
import { getRowClassName } from "../utils/rowUtils";

import type { MappingRow, Override } from "../types/mapping";
import type { Cat } from "./CategoryFilterSelect";

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
        getRowId={(r) => `${r.tag}::${r.id}`}
        editMode="cell"
        density="compact"
        sx={{ height: "100%", width: "100%" }}
        getRowClassName={getRowClassName}
      />
    </Box>
  );
}

export default memo(MappingTableBase);
