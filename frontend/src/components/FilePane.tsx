import {
  Button,
  Box,
  TextField,
  InputAdornment,
  ToggleButtonGroup,
  ToggleButton,
  Tooltip,
  Typography,
  Toolbar,
} from "@mui/material";
import { useLayoutEffect, useRef, useState, useMemo } from "react";
import VirtualFileGrid from "./VirtualFileGrid";

// --- Import a rich set of icons ---
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import SearchIcon from "@mui/icons-material/Search";
import DeselectIcon from "@mui/icons-material/Deselect";
import SelectAllIcon from "@mui/icons-material/SelectAll";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import ShutterSpeedIcon from "@mui/icons-material/ShutterSpeed";
import TuneIcon from "@mui/icons-material/Tune";
import PsychologyIcon from "@mui/icons-material/Psychology";
import SaveIcon from "@mui/icons-material/Save";
import FileCopyIcon from "@mui/icons-material/FileCopy";
import ArchiveIcon from "@mui/icons-material/Archive";

// --- Helper component for displaying folder paths ---
const PathDisplay = ({
  label,
  handle,
}: {
  label: string;
  handle: FileSystemDirectoryHandle | null;
}) => {
  let displayText = label;
  if (handle) {
    displayText = handle.name;
  }

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      {label === "Input" ? <FolderOpenIcon /> : <CreateNewFolderIcon />}
      <Typography variant="body2" noWrap>
        {displayText}
      </Typography>
    </Box>
  );
};

interface Props {
  files: string[];
  currentPreviewFile: string | null;

  /* toggles */
  keep: boolean;
  level: "fast" | "normal" | "deep";
  packageOn: boolean;
  zipPair: boolean;
  onToggleKeep: (val: boolean) => void;
  onLevel: (lv: "fast" | "normal" | "deep") => void;
  onTogglePackage: (val: boolean) => void;
  onToggleZip: (val: boolean) => void;
  selectedSet: Set<string>;
  onToggleFileSelection: (fname: string) => void;
  onPreviewFile: (fname: string) => void;
  onPickDir: () => void;
  onPickOutFolder: () => void;
  selectAll: (all: string[]) => void;
  clearAll: () => void;
  onBatch: () => void;
  batchDisabled?: boolean;
  inputHandle: FileSystemDirectoryHandle | null;
  outputHandle: FileSystemDirectoryHandle | null;
}

export default function FilePane({
  files,
  currentPreviewFile,
  keep,
  level,
  onToggleKeep,
  onLevel,
  onPreviewFile,
  onToggleFileSelection,
  selectedSet,
  onPickDir,
  onPickOutFolder,
  selectAll,
  clearAll,
  onBatch,
  batchDisabled,
  packageOn,
  onTogglePackage,
  zipPair,
  onToggleZip,
  inputHandle,
  outputHandle,
}: Props) {
  /* ─── NEW: Search state and filtering ────────────────────────── */
  const [query, setQuery] = useState("");
  const filteredFiles = useMemo(
    () => files.filter((f) => f.toLowerCase().includes(query.toLowerCase())),
    [files, query]
  );

  const handleSelectAll = () => selectAll(filteredFiles);

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

  const selectedStyle = (isSelected: boolean) =>
    isSelected
      ? {
          color: "primary.contrastText",
          bgcolor: "primary.main",
          "&:hover": { bgcolor: "primary.dark" },
        }
      : {};

  return (
    // CHANGE: Added a wrapper to ensure proper sizing within the Split pane
    <Box
      sx={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        gap: 1.5,
        p: 1.5,
      }}
    >
      {/* --- NEW: Top toolbar with folder selectors and main toggles --- */}
      <Toolbar
        disableGutters
        variant="dense"
        sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 1 }}
      >
        <Button variant="outlined" onClick={onPickDir} sx={{ flexShrink: 0 }}>
          <PathDisplay label="Input" handle={inputHandle} />
        </Button>

        <Button
          variant="outlined"
          onClick={onPickOutFolder}
          sx={{ flexShrink: 0 }}
        >
          <PathDisplay label="Output" handle={outputHandle} />
        </Button>
        <Box
          sx={{
            flex: 1,
            display: "flex",
            justifyContent: "center",
            gap: 1,
            px: 2,
          }}
        >
          <ToggleButton
            value="keep"
            selected={keep}
            onChange={() => onToggleKeep(!keep)}
            size="small"
            sx={selectedStyle(keep)}
          >
            <SaveIcon sx={{ mr: 1 }} /> Keep
          </ToggleButton>
          <ToggleButton
            value="pdf"
            selected={packageOn}
            onChange={() => onTogglePackage(!packageOn)}
            size="small"
            sx={selectedStyle(packageOn)}
          >
            <FileCopyIcon sx={{ mr: 1 }} /> PDF
          </ToggleButton>
          <ToggleButton
            value="zip"
            selected={zipPair}
            disabled={!packageOn}
            onChange={() => onToggleZip(!zipPair)}
            size="small"
            sx={selectedStyle(zipPair)}
          >
            <ArchiveIcon sx={{ mr: 1 }} /> ZIP
          </ToggleButton>
          <Box
            sx={{
              borderLeft: 1,
              borderColor: "divider",
              mx: 1,
              alignSelf: "stretch",
            }}
          />
          <ToggleButtonGroup
            size="small"
            exclusive
            value={level}
            onChange={(e, val) => val && onLevel(val)}
          >
            <Tooltip title="Fast">
              <ToggleButton value="fast">
                <ShutterSpeedIcon />
              </ToggleButton>
            </Tooltip>
            <Tooltip title="Normal">
              <ToggleButton value="normal">
                <TuneIcon />
              </ToggleButton>
            </Tooltip>
            <Tooltip title="Deep">
              <ToggleButton value="deep">
                <PsychologyIcon />
              </ToggleButton>
            </Tooltip>
          </ToggleButtonGroup>
        </Box>
      </Toolbar>

      <Box sx={{ display: "flex", gap: 1, alignItems: "left" }}>
        <TextField
          size="small"
          placeholder="Search files..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
        />

        <Box sx={{ display: "flex", gap: 1, alignItems: "left" }}>
          <Button onClick={clearAll} variant="outlined" size="small">
            <DeselectIcon sx={{ mr: 0.5 }} /> None
          </Button>
          <Button onClick={handleSelectAll} variant="outlined" size="small">
            <SelectAllIcon sx={{ mr: 0.5 }} /> All
          </Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={selectedSet.size === 0 || batchDisabled}
            onClick={onBatch}
            startIcon={<RocketLaunchIcon />}
          >
            Transform {selectedSet.size} / {filteredFiles.length}
          </Button>
        </Box>
      </Box>

      <Box
        sx={{
          flex: 1,
          overflow: "hidden",
          position: "relative",
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
        }}
        ref={boxRef}
      >
        {boxSize.h > 0 && (
          <VirtualFileGrid
            files={filteredFiles}
            height={boxSize.h}
            width={boxSize.w}
            current={currentPreviewFile}
            selectedSet={selectedSet}
            onPreview={onPreviewFile}
            onToggleSelection={onToggleFileSelection}
          />
        )}
      </Box>
    </Box>
  );
}
