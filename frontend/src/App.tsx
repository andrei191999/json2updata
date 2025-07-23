import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useProgress } from "./components/ProgressContext";
import Split from "react-split";
import { Box } from "@mui/material";
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

export default function App() {
  /* ── 1) File list + current file ─────────────────────────────────────── */
  const { files, read: readJson, pick, folderHandle } = useFolder();
  const [selectedSel, setSelectedSel] = useState<Set<string>>(new Set());
  const [level, setLevel] = useState<"fast" | "normal" | "deep">("normal");
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

  const handleKeepMappings = (checked: boolean) => {
    setKeep(checked);
    if (!checked) resetTemplate(); // ← clear the global template
  };

  useEffect(() => {
    clearOvs(); // every time the user picks a brand-new folder
  }, [folderHandle]); // dir === null initially, changes on every pick

  /* ── 5) UI toggles ───────────────────────────────────────────────────── */
  const [keep, setKeep] = useState(false);
  const [loading] = useState(false);
  const [outDir, setOutDir] = useState<FileSystemDirectoryHandle | null>(null);
  const toggle = useCallback((fname: string, on: boolean) => {
    setSelectedSel((prev) => {
      const next = new Set(prev);
      on ? next.add(fname) : next.delete(fname);
      return next;
    });
  }, []);

  const selectAll = useCallback((all: string[]) => {
    setSelectedSel(new Set(all));
  }, []);

  const clearAll = useCallback(() => setSelectedSel(new Set()), []);

  /* 🚚 PDF / ZIP toggles ------------------------------------------ */
  const [packageOn, setPackageOn] = useState(true); // copy PDF next to XML
  const [zipPair, setZipPair] = useState(false); // don’t ZIP by default

  /* ────────────────────────────────────────────────────────────────────── */
  /* #region  Call /map once we have JSON + toggles + spec                 */
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
  ``;

  const rows = useMemo(() => {
    if (
      !json ||
      tagList.length === 0 ||
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
    if (keep) hydrateFile(fname);
    else clearFile(fname);
    setCurrentFile(fname);
    setXml("");
    setJson(await readJson(fname)); // ← use local reader

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

  const [batchResults, setBatchResults] = useState<any[]>([]);
  const [tab, setTab] = useState<"map" | "summary">("map");

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
        console.error("[batchTransform] failed →", err);
        setSnack("Batch failed – see console");
      });

  const handlePreviewFromSummary = (fname: string) => {
    handlePreview(fname); // existing function
    setTab("map");
  };

  /* 10 ───────────────────────────── XML preview once mapping ready  */
  const mappedObj = useMemo(() => toMappedObj(rows), [rows]);

  useEffect(() => {
    if (Object.keys(mappedObj).length === 0) return;
    api.post("/build", { mapped: mappedObj }).then((r) => setXml(r.data));
  }, [mappedObj]);
  /* #endregion */

  useEffect(() => {
    console.debug("template", cache.__template__);
  }, [cache.__template__]);

  /* ────────────────────────────────────────────────────────────────────── */
  /* #region  Render                                                       */
  return (
    <>
      <Box sx={{ display: "flex", gap: 2, p: 1 }}>
        <button onClick={() => setTab("map")}>Mapping</button>
        <button onClick={() => setTab("summary")}>Summary</button>
        {/* NEW — simple toggles, move elsewhere later if you like */}
        <label style={{ marginLeft: 12 }}>
          <input
            type="checkbox"
            checked={packageOn}
            onChange={(e) => setPackageOn(e.target.checked)}
          />
          &nbsp;copy&nbsp;PDF
        </label>

        <label style={{ marginLeft: 8 }}>
          <input
            type="checkbox"
            checked={zipPair}
            onChange={(e) => setZipPair(e.target.checked)}
            disabled={!packageOn}
          />
          &nbsp;zip&nbsp;PDF&nbsp;+&nbsp;XML
        </label>
      </Box>
      {tab === "summary" ? (
        <SummaryTab
          results={batchResults}
          onPreview={handlePreviewFromSummary}
          onBackToMap={() => setTab("map")}
        />
      ) : (
        <Split
          sizes={[20, 80]} // initial percentage sizes
          minSize={280} // minimum pixel size per pane
          gutterSize={8} // width of the drag handle
          direction="horizontal" // “horizontal” means a vertical split
          cursor="col-resize"
          style={{ display: "flex", width: "100%", height: "100%" }}
        >
          {/* LEFT  – file list + toggles */}
          <FilePane
            files={files}
            currentPreviewFile={currentFile}
            onPreviewFile={handlePreview}
            keep={keep}
            onToggleKeep={handleKeepMappings}
            level={level}
            onLevel={setLevel}
            onPickDir={pick}
            onPickOutFolder={pickOutputDir}
            selectedSet={selectedSel}
            onToggleFile={toggle}
            selectAll={() => selectAll(files)}
            clearAll={clearAll}
            onBatch={handleBatch}
            batchDisabled={progress.active}
          />

          {/* RIGHT – mapping + XML preview */}
          <Box
            sx={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              height: "100%",
            }}
          >
            <Box sx={{ flex: 7, overflow: "auto", minHeight: 0, height: "0%" }}>
              <MappingTable
                currentFile={currentFile}
                rows={rows}
                loading={loading}
                suggest={suggest}
                json={json ?? {}}
                onEdit={handleEdit}
              />
            </Box>
            <Box
              sx={{
                flex: 3,
                overflow: "auto",
                borderTop: 1,
                borderColor: "divider",
                minHeight: 0,
              }}
            >
              <PreviewPane xml={xml} />
            </Box>
          </Box>
        </Split>
      )}
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
    </>
  );
  /* #endregion */
}
