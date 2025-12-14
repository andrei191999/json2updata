import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useProgress } from "./components/ProgressContext";
import DebugConsole from "./components/DebugConsole";
import Split from "react-split";
import {
  Box,
  LinearProgress,
  Button,
  Tooltip,
  IconButton,
  Typography,
  Switch, // ✅ Add Switch
  FormControlLabel,
} from "@mui/material";
import { api } from "./api";

import FilePane from "./components/FilePane";
import PreviewPane from "./components/PreviewPane";
import MappingTable from "./components/MappingTable";
import SummaryTab from "./SummaryTab";

import { useMappingCache } from "./hooks/useMappingCache";
import { buildRows } from "./utils/buildRows";
import { toMappedObj } from "./utils/toMappedObj";
import type { Override, MappingRow } from "./types/mapping";
import { useMandatory } from "./hooks/useMandatory";
import { useFolder } from "./hooks/useFolder";
import { batchTransform } from "./utils/batchTransform";
import { debug } from "./utils/debug";
import Snackbar from "@mui/material/Snackbar";
import MuiAlert from "@mui/material/Alert";

import BugReportIcon from "@mui/icons-material/BugReport";
import TocIcon from "@mui/icons-material/Toc";
import AssessmentIcon from "@mui/icons-material/Assessment";

export default function App() {
  // --- State and Hooks ---
  const { files, read: readJson, pick, folderHandle } = useFolder(); // Get folderHandle here
  const [selectedSel, setSelectedSel] = useState<Set<string>>(new Set());
  const [level, setLevel] = useState<"fast" | "normal" | "deep">("normal");
  const [verboseLogging, setVerboseLogging] = useState(true);
  const [snack, setSnack] = useState<string | null>(null);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [json, setJson] = useState<Record<string, unknown> | null>(null);
  const [xml, setXml] = useState<string>("");
  const prevRowsRef = useRef<MappingRow[]>([]);
  const progress = useProgress();

  /* ── 2) Updata spec (tag list + order map + mandatory)  ──────────────────────────── */
  const {
    all: tagList,
    orderMap,
    required,
    conditional,
    parentReq,
    parentOpt,
  } = useMandatory();

  /* ── 3) Backend “/map” result for *current* file ─────────────────────── */
  const [mapped, setMapped] = useState<Record<string, unknown>>({});
  const [suggest, setSuggest] = useState<
    Record<string, Array<[string, number]>>
  >({});

  /* ── 4) User overrides (all files)  ──────────────────────────────────── */
  const { cache, edit, clearFile, hydrateFile, resetTemplate, clearOvs } =
    useMappingCache();
  const [keep, setKeep] = useState(false);
  const [loading] = useState(false);
  const [debugConsoleOpen, setDebugConsoleOpen] = useState(false);
  const [outDir, setOutDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [packageOn, setPackageOn] = useState(true);
  const [zipPair, setZipPair] = useState(false);
  const [batchResults, setBatchResults] = useState<any[]>([]);
  const [tab, setTab] = useState<"map" | "summary">("map");

  // --- Callbacks and Handlers ---
  window.addEventListener("error", (e) => {
    console.debug("[bt] window:error", {
      msg: e.message,
      src: e.filename,
      line: e.lineno,
      col: e.colno,
    });
  });
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    console.debug("[bt] window:unhandledrejection", {
      reason: String(e.reason),
    });
  });

  const handleKeepMappings = (checked: boolean) => {
    setKeep(checked);
    if (!checked) resetTemplate();
  };

  useEffect(() => {
    clearOvs();
  }, [folderHandle]);

  const toggleFileSelection = useCallback((fname: string) => {
    setSelectedSel((prev) => {
      const next = new Set(prev);
      if (next.has(fname)) next.delete(fname);
      else next.add(fname);
      return next;
    });
  }, []);

  const selectAll = useCallback((all: string[]) => {
    setSelectedSel(new Set(all));
  }, []);

  const clearAll = useCallback(() => setSelectedSel(new Set()), []);

  useEffect(() => {
    if (!json || tagList.length === 0) return;
    api.post(`/map?level=${level}`, json).then((res) => {
      setMapped(res.data.mapped);
      setSuggest(res.data.suggest);
    });
  }, [json, tagList]);
  /* #endregion */

  /* ────────────────────────────────────────────────────────────────────── */
  /* #region  Compute rows for MappingTable                                */
  const overrides = useMemo(() => {
    const fileOverrides = currentFile ? cache[currentFile] ?? {} : {};
    const templateOverrides = cache.__template ?? {};
    return { ...templateOverrides, ...fileOverrides };
  }, [currentFile, cache]);

  const rows = useMemo(() => {
    if (
      !json ||
      tagList.length === 0 ||
      // ✅ FIX: Add a guard to ensure orderMap is populated.
      // This prevents buildRows from running with data that would break sorting.
      !orderMap ||
      Object.keys(orderMap).length === 0 ||
      (required.size === 0 && conditional.size === 0)
    ) {
      return [];
    }
    const newRows = buildRows(prevRowsRef.current, {
      json,
      backendMapped: mapped,
      backendSuggest: suggest,
      overrides,
      tagList,
      orderMap,
      required,
      conditional,
      parentReq,
      parentOpt,
    });

    prevRowsRef.current = newRows; // remember for the next render
    return newRows;
  }, [
    json,
    mapped,
    suggest,
    overrides,
    tagList,
    orderMap,
    required,
    conditional,
    parentReq,
    parentOpt,
  ]);

  /* ─────────────────────────────── higher-level helpers & handlers */
  const handleEdit = useCallback(
    (tag: string, patch: Override) =>
      currentFile && edit(currentFile, tag, patch, keep),
    [currentFile, edit, keep]
  );

  const handlePreview = async (fname: string) => {
    setCurrentFile(fname); // Set as current file for preview
    if (keep) hydrateFile(fname);
    else clearFile(fname);
    setJson(await readJson(fname));
    debug("preview", `[${fname}] overrides in play →`, {
      template: cache.__template__,
      file: cache[fname],
    });
  };

  /* user can override the default ./output directory */
  const pickOutputDir = useCallback(async () => {
    if (!window.showDirectoryPicker) {
      alert("Directory picker not supported.");
      return;
    }
    setOutDir(await window.showDirectoryPicker());
  }, []);

  const handleBatch = () =>
    batchTransform(
      Array.from(selectedSel),
      readJson,
      cache,
      folderHandle,
      outDir,
      api,
      level,
      packageOn,
      zipPair,
      progress
    )
      .then((res) => {
        setBatchResults(res || []);
        setTab("summary");
        setSnack(
          `Finished ${selectedSel.size} file${selectedSel.size > 1 ? "s" : ""}`
        );
      })
      .catch((err) => {
        setSnack("Batch failed – see console");
      });

  const handlePreviewFromSummary = (fname: string) => {
    handlePreview(fname); // existing function
    setTab("map");
  };

  const handleLogToggle = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const isVerbose = event.target.checked;
      setVerboseLogging(isVerbose);
      try {
        await api.post("/log-level", { level: isVerbose ? "DEBUG" : "INFO" });
      } catch (error) {
        console.error("Failed to set log level", error);
      }
    },
    []
  );

  /* 10 ───────────────────────────── XML preview once mapping ready  */
  const mappedObj = useMemo(() => toMappedObj(rows), [rows]);

  useEffect(() => {
    if (Object.keys(mappedObj).length === 0) {
      setXml("");
      return;
    }
    api.post("/build", { mapped: mappedObj }).then((r) => setXml(r.data));
  }, [mappedObj]);
  /* #endregion */

  useEffect(() => {
    console.debug("template", cache.__template__);
  }, [cache.__template__]);

  /* ────────────────────────────────────────────────────────────────────── */
  /* #region  Render                                                       */
  return (
    // CHANGE: Added a flex container to ensure the layout fills the viewport height
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1, // smaller gap
          p: 1,
          flexWrap: "wrap",
          flexShrink: 0, // Prevent this header from shrinking
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        {/* --- NEW: Buttons with icons --- */}
        <Button
          variant={tab === "map" ? "contained" : "outlined"}
          onClick={() => setTab("map")}
          startIcon={<TocIcon />}
        >
          Mapping
        </Button>
        <Button
          variant={tab === "summary" ? "contained" : "outlined"}
          onClick={() => setTab("summary")}
          startIcon={<AssessmentIcon />}
        >
          Summary
        </Button>
        <Box sx={{ flex: 1 }} /> {/* Spacer */}
        {progress.active && (
          <>
            <Button
              size="small"
              variant="outlined"
              color="error"
              onClick={progress.cancel}
            >
              Cancel
            </Button>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 2, // Increased gap
                minWidth: 300, // Increased minWidth
                flex: 1, // Allow it to take more space
                maxWidth: 400,
              }}
            >
              <LinearProgress
                variant={progress.max ? "determinate" : "indeterminate"}
                value={progress.max ? (progress.cur / progress.max) * 100 : 0}
                sx={{ flex: 1, height: 10, borderRadius: 5 }}
              />
              <Typography variant="body2" sx={{ whiteSpace: "nowrap" }}>
                {progress.label}{" "}
                {progress.max ? `(${progress.cur}/${progress.max})` : ""}
              </Typography>
            </Box>
          </>
        )}
        <Box sx={{ flex: 1 }} /> {/* Spacer */}
        <Tooltip
          title={
            verboseLogging
              ? "Show all debug messages"
              : "Show only info and errors"
          }
        >
          <FormControlLabel
            sx={{ color: "text.secondary" }}
            control={
              <Switch
                checked={verboseLogging}
                onChange={handleLogToggle}
                size="small"
              />
            }
            label={<Typography variant="caption">Verbose Logs</Typography>}
          />
        </Tooltip>
        <Tooltip title="Debug console">
          <IconButton
            onClick={() => setDebugConsoleOpen(true)}
            sx={{ color: "success.main" }}
          >
            <BugReportIcon />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        {" "}
        {/* CHANGE: This box will contain the main content and allow it to grow */}
        {tab === "summary" ? (
          <SummaryTab
            results={batchResults}
            onPreview={handlePreviewFromSummary}
            onBackToMap={() => {
              setTab("map");
              progress.dismiss();
            }}
          />
        ) : (
          <Split
            sizes={[35, 65]}
            minSize={[400, 500]}
            gutterSize={8}
            direction="horizontal"
            cursor="col-resize"
            style={{ display: "flex", width: "100%", height: "100%" }}
          >
            {/* LEFT  – file list + toggles */}
            {/* CHANGE: Pass output toggles down to FilePane */}
            <FilePane
              files={files}
              currentPreviewFile={currentFile}
              onPreviewFile={handlePreview}
              onToggleFileSelection={toggleFileSelection}
              keep={keep}
              onToggleKeep={handleKeepMappings}
              level={level}
              onLevel={setLevel}
              onPickDir={pick}
              onPickOutFolder={pickOutputDir}
              selectedSet={selectedSel}
              selectAll={() => selectAll(files)}
              clearAll={clearAll}
              onBatch={handleBatch}
              batchDisabled={progress.active}
              packageOn={packageOn}
              onTogglePackage={setPackageOn}
              zipPair={zipPair}
              onToggleZip={setZipPair}
              // --- NEW: Pass folder handles to FilePane ---
              inputHandle={folderHandle}
              outputHandle={outDir}
            />

            {/* RIGHT – mapping + XML preview */}
            <Split
              direction="vertical"
              sizes={[70, 30]} // --- CHANGED: Preview pane gets 30% now
              minSize={100}
              gutterSize={8}
              style={{ height: "100%", minWidth: 0 }}
            >
              <Box sx={{ overflow: "auto", height: "100%", width: "100%" }}>
                <MappingTable
                  currentFile={currentFile}
                  rows={rows}
                  loading={loading}
                  suggest={suggest}
                  json={json ?? {}}
                  onEdit={handleEdit}
                  tagList={tagList}
                />
              </Box>
              <Box sx={{ overflow: "auto", height: "100%", width: "100%" }}>
                <PreviewPane xml={xml} />
              </Box>
            </Split>
          </Split>
        )}
      </Box>
      {/* ─── transient toaster ───────────────────────────── */}
      <Snackbar
        open={!!snack}
        autoHideDuration={4000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <MuiAlert
          severity="info"
          elevation={6}
          variant="filled"
          onClose={() => setSnack(null)}
        >
          {snack}
        </MuiAlert>
      </Snackbar>
      <DebugConsole
        open={debugConsoleOpen}
        onClose={() => setDebugConsoleOpen(false)}
      />
    </Box>
  );
  /* #endregion */
}
