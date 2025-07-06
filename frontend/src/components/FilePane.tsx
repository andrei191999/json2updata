import {
  Toolbar,
  Button,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Box,
  Checkbox,
  Typography,
  Switch,
  Select,
  MenuItem,
} from "@mui/material";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";

/* ──────────────────────────────────────────────────────────────── */
/* Props – everything except `files` & `currentPreviewFile` is now OPTIONAL */
interface Props {
  files: string[];
  currentPreviewFile: string | null;

  /* toggles */
  keep?: boolean;
  level?: "fast" | "normal" | "deep";

  onToggleKeep: (checked: boolean) => void;
  onLevel?: (lv: "fast" | "normal" | "deep") => void;

  /* batch-mode (optional) */
  selectedFiles?: string[];
  onToggleFile?: (fname: string, isChecked: boolean) => void;

  /* callbacks */
  onPreviewFile: (fname: string) => void;
  onPickDir: () => void;
  onPickOutFolder: () => void;

  selectAll: (all: string[]) => void;
  clearAll: () => void;
  onBatch: () => void;
}

/* Extend Window interface for FS Access API */
declare global {
  interface Window {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  }
}

export default function FilePane({
  files,
  currentPreviewFile,
  keep = false,
  level = "normal",
  onToggleKeep = () => {},
  onLevel = () => {},
  selectedFiles = [],
  onToggleFile = () => {},
  onPreviewFile,
  onPickDir = () => {},
  onPickOutFolder = () => {},
  selectAll,
  clearAll = () => {},
  onBatch = () => {},
}: Props) {
  /* ─── render ──────────────────────────────────────────────────── */
  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Toolbar variant="dense" sx={{ minHeight: 34, px: 1 }}>
        <Button startIcon={<FolderOpenIcon />} size="small" onClick={onPickDir}>
          Choose Folder
        </Button>

        <Button onClick={onPickOutFolder}>Output folder…</Button>

        <Button size="small" onClick={() => selectAll(files)}>
          Select all files
        </Button>
        <Button size="small" onClick={clearAll}>
          None
        </Button>

        {/* NEW – Batch transform */}
        <Button
          size="small"
          variant="contained"
          sx={{ ml: "auto" }}
          disabled={selectedFiles.length === 0}
          onClick={onBatch}
        >
          Transform ({selectedFiles.length})
        </Button>

        <Select
          size="small"
          value={level}
          onChange={(e) => onLevel?.(e.target.value as any)}
          sx={{ mx: 1, minWidth: 90 }}
        >
          <MenuItem value="fast">Fast</MenuItem>
          <MenuItem value="normal">Normal</MenuItem>
          <MenuItem value="deep">Deep</MenuItem>
        </Select>

        <Switch
          checked={keep}
          onChange={(e) => onToggleKeep(e.target.checked)}
          size="small"
          sx={{ ml: 1 }}
        />
        <Typography variant="caption" sx={{ ml: 0.5 }}>
          Keep mappings
        </Typography>
      </Toolbar>

      <Typography
        variant="caption"
        sx={{ px: 1, pt: 0.5, color: "gray", fontStyle: "italic" }}
      >
        (Check multiple for batch, click name to preview)
      </Typography>

      <List
        dense
        sx={{
          flex: 1,
          overflow: "auto",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
        }}
      >
        {files.map((f) => {
          const isPreview = f === currentPreviewFile;

          return (
            <ListItem
              key={f}
              disablePadding
              sx={{
                bgcolor: isPreview ? "rgba(0,0,200,0.1)" : "transparent",
                "&:hover": {
                  bgcolor: isPreview ? undefined : "rgba(0,0,0,0.04)",
                },
              }}
            >
              {/* Render checkbox only if batch-mode props provided */}
              {selectedFiles && (
                <ListItemIcon>
                  <Checkbox
                    edge="start"
                    size="small"
                    checked={selectedFiles.includes(f)}
                    onChange={(e) => onToggleFile(f, e.target.checked)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </ListItemIcon>
              )}

              <ListItemText
                primary={f}
                onClick={() => onPreviewFile(f)}
                sx={{
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              />
            </ListItem>
          );
        })}
      </List>
    </Box>
  );
}
