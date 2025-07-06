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
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useState } from "react";

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
            setXmlBody(p.row.prettyXml);
            setXmlMeta(p.row.meta);
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
              <ErrorOutlineIcon color="warning" sx={{ mr: 0.5 }} />
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
      maxWidth: 700,
      renderCell: (params) =>
        params.value && !params.value.valid ? (
          <Tooltip title={params.value.message}>
            <span style={{ color: "red" }}>{params.value.message}</span>
          </Tooltip>
        ) : (
          <span>OK</span>
        ),
    },
  ];

  return (
    <Box sx={{ height: 560, width: "100%", p: 2 }}>
      <DataGrid
        rows={results.map((r, i) => ({ id: i, ...r }))}
        columns={columns}
        pageSize={results.length}
        density="compact"
        getRowClassName={(p) => (!p.row.success ? "row-fail" : "")}
        sx={{
          "& .MuiDataGrid-root": { tableLayout: "fixed" },
          "& .MuiDataGrid-cell": {
            whiteSpace: "normal",
            wordBreak: "break-word",
            lineHeight: "1.2em",
          },
          "& .row-fail": { background: "#ffe8e8" },
        }}
      />
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
            mapped {xmlMeta.mapped}/{xmlMeta.required} tags
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
      <pre style={{ fontSize: 12, color: "#aaa", marginTop: 12 }}>
        {JSON.stringify(results, null, 2)}
      </pre>
    </Box>
  );
}
