import { useMemo, useState } from "react";
import { DataGrid } from "@mui/x-data-grid";
import type { GridColDef } from "@mui/x-data-grid";
import {
  Box,
  Tooltip,
  IconButton,
  Dialog,
  DialogActions,
  Button,
  DialogContent,
  DialogTitle,
  Paper,
  Typography,
  TextField,
  InputAdornment,
  Switch,
  FormControlLabel,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import VisibilityIcon from "@mui/icons-material/Visibility";
import SearchIcon from "@mui/icons-material/Search";

interface BatchResult {
  file: string;
  success: boolean;
  xml?: string;
  validation: { valid: boolean; message: string };
  warnings: string[];
  errors: string[];
}

interface Props {
  results: BatchResult[];
  onPreview: (file: string) => void; // callback to open file preview
  onBackToMap: () => void;
}

export default function SummaryTab({ results, onPreview, onBackToMap }: Props) {
  const [xmlOpen, setXmlOpen] = useState(false);
  const [xmlBody, setXmlBody] = useState("");
  const [xmlMeta, setXmlMeta] = useState<Record<string, any>>({});

  // ✅ STATE for new search and filter controls
  const [searchText, setSearchText] = useState("");
  const [showFailedOnly, setShowFailedOnly] = useState(false);

  // View-only guardrail: dedupe by `file` (first-wins)
  const deduped = useMemo(() => {
    const seen = new Set<string>();
    const out: typeof results = [];
    for (const r of results || []) {
      if (!r?.file) continue;
      if (seen.has(r.file)) continue;
      seen.add(r.file);
      out.push(r);
    }
    return out;
  }, [results]);

  // ✅ RECOMMENDATION 1: Calculate aggregate stats for a better overview.
  const stats = useMemo(() => {
    const succeeded = deduped.filter((r) => r.success).length;
    const failed = deduped.length - succeeded;
    return { succeeded, failed, total: deduped.length };
  }, [deduped]);

  // ✅ Filter results based on the search text and "show failed" toggle.
  const filteredResults = useMemo(() => {
    let items = deduped;
    if (showFailedOnly) {
      items = items.filter((r) => !r.success);
    }
    if (searchText) {
      items = items.filter((r) =>
        r.file.toLowerCase().includes(searchText.toLowerCase())
      );
    }
    return items;
  }, [deduped, searchText, showFailedOnly]);

  const columns: GridColDef[] = [
    {
      field: "success",
      headerName: "Status",
      width: 90,
      renderCell: (params) =>
        params.value ? (
          <Tooltip title="Valid XML">
            <CheckCircleIcon color="success" />
          </Tooltip>
        ) : (
          <Tooltip title="Invalid XML">
            <CancelIcon color="error" />
          </Tooltip>
        ),
    },
    {
      field: "file",
      headerName: "File",
      width: 300,
      renderCell: (params) => <strong>{params.value}</strong>,
    },
    {
      field: "preview",
      headerName: "Preview",
      width: 80,
      sortable: false,
      renderCell: (params) => (
        <IconButton
          size="small"
          onClick={() => {
            onPreview(params.row.file);
            onBackToMap();
          }}
        >
          <VisibilityIcon />
        </IconButton>
      ),
    },
    {
      field: "xml",
      headerName: "XML",
      width: 60,
      sortable: false,
      renderCell: (p) => (
        <IconButton
          size="small"
          onClick={() => {
            setXmlBody(p.row.xml);
            setXmlMeta(p.row.meta ?? {});
            setXmlOpen(true);
          }}
        >
          <VisibilityIcon fontSize="small" />
        </IconButton>
      ),
    },
    {
      field: "errors",
      headerName: "Errors",
      width: 90,
      renderCell: (p) =>
        Array.isArray(p.value) && p.value.length ? (
          <Tooltip title={p.value.join(", ")}>
            <span style={{ color: "#d32f2f", fontWeight: 600 }}>
              {p.value.length}
            </span>
          </Tooltip>
        ) : (
          <span style={{ color: "#999" }}>-</span>
        ),
    },
    {
      field: "warnings",
      headerName: "Warnings",
      width: 105,
      renderCell: (p) =>
        Array.isArray(p.value) && p.value.length ? (
          <Tooltip title={p.value.join(", ")}>
            <span>
              <ErrorOutlineIcon
                color="warning"
                sx={{ mr: 0.5, verticalAlign: "bottom" }}
              />
              {p.value.length}
            </span>
          </Tooltip>
        ) : (
          <span style={{ color: "#999" }}>-</span>
        ),
    },
    {
      field: "validation",
      headerName: "Validation Message",
      flex: 1,
      minWidth: 200,
      renderCell: (params) =>
        params.value && !params.value.valid ? (
          <Tooltip title={params.value.message}>
            <span style={{ color: "red", whiteSpace: "pre-wrap" }}>
              {params.value.message}
            </span>
          </Tooltip>
        ) : (
          <span>OK</span>
        ),
    },
  ];

  return (
    // ✅ Main container uses flexbox to fill the available height and manage the 70/30 split.
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        p: 2,
        gap: 2,
      }}
    >
      {/* --- Header Controls --- */}
      <Box
        sx={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}
      >
        {/* ✅ Search bar moved to the left */}
        <TextField
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Search filenames..."
          size="small"
          sx={{ minWidth: 300 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
        />
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          |
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Processed: <strong>{stats.total}</strong> | Succeeded:{" "}
          <strong style={{ color: "green" }}>{stats.succeeded}</strong> |
          Failed: <strong style={{ color: "red" }}>{stats.failed}</strong>
        </Typography>
        <Box sx={{ flex: 1 }} />

        {/* ✅ RECOMMENDATION 2: Add a filter for failed items */}
        <FormControlLabel
          control={
            <Switch
              checked={showFailedOnly}
              onChange={(e) => setShowFailedOnly(e.target.checked)}
            />
          }
          label="Show Failed Only"
        />
      </Box>

      {/* --- DataGrid Container (Takes up 70% of available space) --- */}
      <Box sx={{ flex: "1", minHeight: 0 }}>
        <DataGrid
          // ✅ Pass the filtered data to the grid
          rows={filteredResults.map((r, i) => ({ id: i, ...r }))}
          columns={columns}
          density="compact"
          getRowClassName={(p) => (!p.row.success ? "row-fail" : "")}
          sx={{
            minWidth: 0,
            // ✅ FIX: Override the default theme border and apply our own.
            "--DataGrid-rowBorderColor": "transparent", // Disables the default bottom border
            "& .MuiDataGrid-row": {
              borderTop: "1px solid rgba(255, 255, 255, 0.1)", // Apply a clean top border to all rows
            },
            "& .MuiDataGrid-cell": {
              whiteSpace: "normal",
              wordBreak: "break-word",
              lineHeight: "1.3em",
              py: 1,
            },
            "& .row-fail": { background: "rgba(255, 0, 0, 0.05)" },
          }}
        />
      </Box>

      {/* --- JSON Preview Container (Takes up 30% of available space) --- */}
      <Box sx={{ height: "30%", display: "flex", flexDirection: "column" }}>
        <Paper
          variant="outlined"
          // The Paper component itself will handle scrolling its content.
          sx={{ p: 2, flex: 1, overflow: "auto" }}
        >
          <Typography
            variant="overline"
            sx={{ display: "block", color: "text.secondary" }}
          >
            Raw Batch Results
          </Typography>
          <pre
            style={{
              fontSize: 12,
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {JSON.stringify(filteredResults, null, 2)}
          </pre>
        </Paper>
      </Box>

      {/* XML Preview Dialog */}
      <Dialog
        open={xmlOpen}
        onClose={() => setXmlOpen(false)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>
          XML preview – {xmlMeta.size ?? ""}
        </DialogTitle>

        <DialogContent dividers sx={{ maxHeight: "70vh" }}>
          <Box sx={{ mb: 1, fontSize: 13, color: "#666" }}>
            mapped {xmlMeta?.mapped ?? "-"}/{xmlMeta?.required ?? "-"} tags
          </Box>

          <pre
            style={{
              margin: 0,
              fontFamily: "Menlo,monospace",
              fontSize: 12,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {xmlBody}
          </pre>
        </DialogContent>

        <DialogActions>
          <Button
            onClick={() => setXmlOpen(false)}
            variant="outlined"
            size="small"
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
