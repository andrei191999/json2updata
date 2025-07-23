import {
  Toolbar,
  Button,
  Box,
  Typography,
  Switch,
  Select,
  MenuItem,
} from "@mui/material";
import { useLayoutEffect, useRef, useState } from "react";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import VirtualFileGrid from "./VirtualFileGrid";

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
  selectedSet?: Set<string>;
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
  onToggleFile = () => {},
  onPreviewFile,
  selectedSet = new Set<string>(),
  onPickDir = () => {},
  onPickOutFolder = () => {},
  selectAll,
  clearAll = () => {},
  onBatch = () => {},
}: Props) {
  const handleToggle = onToggleFile;
  /* ── measure container size so grid is responsive ─────────────── */
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setBoxSize({ w: el.clientWidth, h: el.clientHeight })
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
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
          disabled={selectedSet.size === 0}
          onClick={onBatch}
        >
          Transform ({selectedSet.size})
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

      <Box
        sx={{
          flex: 1,
          overflow: "hidden",
          position: "relative",
        }}
        ref={boxRef}
      >
        {boxSize.h > 0 && (
          <VirtualFileGrid
            files={files}
            height={boxSize.h}
            width={boxSize.w}
            current={currentPreviewFile}
            selectedSet={selectedSet}
            onToggle={handleToggle}
            onPreview={onPreviewFile}
          />
        )}
      </Box>
    </Box>
  );
}
