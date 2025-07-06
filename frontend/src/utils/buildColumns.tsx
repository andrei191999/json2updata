import type { GridColDef } from "@mui/x-data-grid";
import { Checkbox, Tooltip, Box } from "@mui/material";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";

import IncludeCell from "../components/edit/IncludeCell";
import JsonFieldEditCell from "../components/edit/JsonFieldEditCell";
import ValueCell from "../components/cell/ValueCell";
import CategoryFilterSelect from "../components/CategoryFilterSelect";

import { catGetter, catName } from "./rowUtils";
import { debug } from "./debug";

import type { MappingRow } from "../types/mapping";
import type { Override } from "../types/mapping";
import type { Cat } from "../components/CategoryFilterSelect";

/* ------------------------------------------------------------------ */
/* Options injected from MappingTable (keeps this util *pure*)        */
interface BuildOpts {
  selectedCats: Cat[];
  setSelectedCats: (cats: Cat[]) => void;

  includeState: "all" | "some" | "none";
  toggleSubset: (subset: MappingRow[], checked: boolean) => void;

  json: Record<string, unknown>;
  jsonKeys: string[];
  suggest: Record<string, Array<[string, number]>>;
  onEdit: (tag: string, patch: Override, touchTemplate?: boolean) => void;

  visibleRows: MappingRow[];
}

/* ------------------------------------------------------------------ */
/* Column factory — returns a fresh array, but heavy work (renderCell */
/* callbacks) shares closures from the injected opts.                 */
export function buildColumns({
  selectedCats,
  setSelectedCats,
  includeState,
  toggleSubset,

  json,
  jsonKeys,
  suggest,
  onEdit,
  visibleRows,
}: BuildOpts): GridColDef[] {
  debug("[buildColumns] rebuilding — includeState =", includeState);

  return [
    /* 0️⃣  Category (M / C / O / P) ---------------------------------- */
    {
      field: "cat",
      headerName: "Cat",
      width: 100,
      sortable: false,
      filterable: false,
      disableColumnMenu: true,
      valueGetter: catGetter,
      renderHeader: () => (
        <CategoryFilterSelect
          selected={selectedCats}
          onChange={setSelectedCats}
        />
      ),
      renderCell: (p) => {
        const code = p.value as Cat;
        return (
          <Tooltip title={catName[code]}>
            <strong>{code}</strong>
          </Tooltip>
        );
      },
    },

    /* 1️⃣  Warning icon (missing JSON key) --------------------------- */
    {
      field: "warning",
      headerName: "",
      width: 36,
      sortable: false,
      filterable: false,
      disableColumnMenu: true,
      renderCell: (p) =>
        p.value ? (
          <Tooltip title="JSON key missing">
            <ErrorOutlineIcon fontSize="small" color="warning" />
          </Tooltip>
        ) : null,
    },

    /* 2️⃣  Updata tag ----------------------------------------------- */
    {
      field: "tag",
      headerName: "Updata tag",
      width: 240,
      editable: false,
      renderCell: (params) => {
        const label = (params.row as any).label ?? params.value;
        return <strong>{label}</strong>;
      },
    },

    /* 3️⃣  JSON-field picker ----------------------------------------- */
    {
      field: "jsonKey",
      headerName: "JSON field",
      width: 300,
      editable: true,
      renderCell: (params) => (
        <JsonFieldEditCell
          {...params}
          suggest={suggest}
          jsonKeys={jsonKeys}
          json={json}
          onEdit={onEdit}
        />
      ),
    },

    /* 4️⃣  Value preview / editor ----------------------------------- */
    {
      field: "value",
      headerName: "Value",
      flex: 1,
      minWidth: 140,
      maxWidth: 400,
      renderCell: (params) => (
        <ValueCell
          {...params}
          json={json}
          jsonKeys={jsonKeys}
          onEdit={onEdit}
        />
      ),
    },

    /* 5️⃣  Include checkbox ----------------------------------------- */
    {
      field: "include",
      headerName: "Include",
      width: 100,
      sortable: false,
      filterable: false,
      renderHeader: () => (
        <Box
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Checkbox
            size="small"
            indeterminate={includeState === "some"}
            checked={includeState === "all"}
            onChange={(e) => {
              debug(
                "[buildColumns] header checkbox →",
                e.target.checked,
                "on",
                visibleRows.length,
                "rows"
              );
              toggleSubset(visibleRows, e.target.checked);
            }}
          />
        </Box>
      ),
      renderCell: (params) => <IncludeCell {...params} onEdit={onEdit} />,
    },
  ];
}
