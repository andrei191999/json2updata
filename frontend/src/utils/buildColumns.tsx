import type { GridColDef, GridRenderCellParams } from "@mui/x-data-grid";
import { Checkbox, Tooltip, Box, Typography, IconButton } from "@mui/material";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import EditIcon from "@mui/icons-material/Edit";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

import IncludeCell from "../components/edit/IncludeCell";
import JsonFieldEditCell from "../components/edit/JsonFieldEditCell";
import ValueCell from "../components/cell/ValueCell";
import CategoryFilterSelect from "../components/CategoryFilterSelect";

import { catGetter, catName } from "./rowUtils";
import { debug } from "./debug";

import type { MappingRow } from "../types/mapping";
import type { Override } from "../types/mapping";
import type { Cat } from "../components/CategoryFilterSelect";

// Read-only display for column 4 (JSON Field)
const JsonFieldDisplayCell = (
  params: GridRenderCellParams<any, MappingRow>
) => {
  const { row } = params;
  let displayValue = row.jsonKey;
  if (row.mode === "alias") displayValue = `Alias: ${row.aliasFor}`;
  if (row.mode === "hard") displayValue = "Hard-coded";
  if (row.mode === "pick") displayValue = "Pick from JSON input...";
  return (
    <Typography
      variant="body2"
      sx={{ fontStyle: "italic", color: "text.secondary" }}
    >
      {displayValue || "—"}
    </Typography>
  );
};

interface BuildOpts {
  selectedCats: Cat[];
  setSelectedCats: (cats: Cat[]) => void;
  includeState: "all" | "some" | "none";
  toggleSubset: (subset: MappingRow[], checked: boolean) => void;
  json: Record<string, unknown>;
  jsonKeys: string[];
  suggest: Record<string, Array<[string, number]>>;
  onEdit: (
    tag: string,
    patch: Partial<Override>,
    touchTemplate?: boolean
  ) => void;

  visibleRows: MappingRow[];
  openEditor: (row: MappingRow) => void;
  tagList: string[];
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
  openEditor,
  tagList,
}: BuildOpts): GridColDef[] {
  debug("[buildColumns] rebuilding — includeState =", includeState);

  return [
    /* 0️⃣  Category (M / C / O / P) ---------------------------------- */
    {
      field: "cat",
      headerName: "Category",
      flex: 0.7,
      minWidth: 100,
      sortable: false,
      align: "center",
      headerAlign: "center",
      filterable: false,
      disableColumnMenu: true,
      valueGetter: catGetter,
      renderHeader: (params) => (
        // ✅ Wrap title and filter in a flex container
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: "bold" }}>
            {params.colDef.headerName}
          </Typography>
          <CategoryFilterSelect
            selected={selectedCats}
            onChange={setSelectedCats}
          />
        </Box>
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
      headerName: "Warnings",
      flex: 0.6,
      minWidth: 70,
      align: "center",
      headerAlign: "center",
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
      flex: 2.5,
      minWidth: 300,
      editable: false,
      headerAlign: "center",
      sortable: false,
      // renderCell: (params) => {
      //   // We only want to show the last part of the tag path
      //   const tagParts = params.value.split(".");
      //   const visibleTag = tagParts[tagParts.length - 1];
      //   const depth = params.row.depth ?? 0;

      //   return (
      //     // ✅ Use a tooltip to show the full path on hover
      //     <Tooltip title={params.value} placement="top-start">
      //       {/* ✅ Apply left padding based on the row's depth */}
      //       <Box sx={{ paddingLeft: `${depth * 30}px` }}>
      //         <strong>{visibleTag}</strong>
      //       </Box>
      //     </Tooltip>
      //   );
      // },
      renderCell: (params) => {
        const r = params.row as any; // MappingRow
        const depth = r.depth ?? 0;

        // show friendly label when provided (e.g. "Output filename (PDF)")
        const fallback = (() => {
          const parts = String(params.value ?? "").split(".");
          return parts[parts.length - 1];
        })();

        const visible = r.label || fallback;

        return (
          <Tooltip title={String(params.value ?? "")} placement="top-start">
            <Box sx={{ paddingLeft: `${depth * 30}px` }}>
              <strong>{visible}</strong>
            </Box>
          </Tooltip>
        );
      },
    },

    /*  JSON-field picker ----------------------------------------- */
    {
      field: "jsonKey",
      headerName: "JSON Field",
      flex: 2,
      minWidth: 250,
      sortable: false,
      editable: true,
      headerAlign: "center",
      renderCell: (params) => <JsonFieldDisplayCell {...params} />,
      renderEditCell: (params) => (
        <JsonFieldEditCell {...params} suggest={suggest} onEdit={onEdit} />
      ),
    },

    /* Value column also gets a separate display and edit cell */
    {
      field: "value",
      headerName: "Value",
      flex: 2.5,
      minWidth: 300,
      sortable: false,
      headerAlign: "center",
      editable: true,
      renderCell: (params) => (
        <Typography variant="body2">
          {String((params.row as MappingRow).value ?? "")}
        </Typography>
      ),
      renderEditCell: (params) => (
        <ValueCell
          {...params}
          json={json}
          jsonKeys={jsonKeys}
          tagList={tagList}
          onEdit={onEdit}
        />
      ),
    },

    /* 4½  Launch overlay editor ------------------------------------ */
    {
      field: "xform",
      headerName: "",
      flex: 0.5,
      minWidth: 50,
      sortable: false,
      filterable: false,
      align: "center",
      headerAlign: "center",
      disableColumnMenu: true,
      renderCell: (p) => {
        const edited = (p.row as MappingRow).xform?.length;
        return (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              openEditor(p.row as MappingRow);
            }}
          >
            {edited ? (
              <CheckCircleIcon fontSize="small" color="success" />
            ) : (
              <EditIcon fontSize="small" color="action" />
            )}
          </IconButton>
        );
      },
    },

    /* 5️⃣  Include checkbox ----------------------------------------- */
    {
      field: "include",
      headerName: "Include",
      flex: 0.5,
      minWidth: 60,
      sortable: false,
      filterable: false,
      align: "center",
      headerAlign: "center",
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
