/**
 * ------------------------------------------------------------
 * Batch-convert every selected *.json into Updata XML.
 *
 * 1.  Map each JSON locally (fast, offline)                   ✅
 * 2.  Ensure its *matching PDF* is present on the backend
 *     ─ if missing, upload it once                            ✅
 * 3.  FAST PATH  →  POST /api/batch_build                     ✅
 * 4.  FALLBACK   →  do everything in-browser
 *
 * Upload happens *here*, not when the folder is picked, so any
 * filename changes made in the mapping table are in place first.
 */

import type { AxiosInstance } from "axios";
import { buildRows } from "./buildRows";
import { applyMapping } from "./applyMapping";
import { debug } from "./debug";
import type { MappingCache, Override } from "../types/mapping";
import type { ProgressAPI } from "../components/ProgressContext";

/* ───────────── helper: does backend already have <dest>/<name>? */
async function backendHas(
  api: AxiosInstance,
  dest: string,
  name: string
): Promise<boolean> {
  const { data } = await api.get("/file_exists", { params: { dest, name } });
  return Boolean(data.exists);
}

/* ───────────── helper: upload File → backend:/upload if needed */
async function uploadPdfIfNeeded(
  api: AxiosInstance,
  folder: FileSystemDirectoryHandle,
  pdfName: string,
  dest: string
) {
  if (await backendHas(api, dest, pdfName)) {
    debug("batchTransform", `↳ skip (already on server) ${pdfName}`);
    return;
  }

  try {
    const handle = await folder.getFileHandle(pdfName);
    const file = await handle.getFile();
    const fd = new FormData();
    fd.append("file", file, pdfName);
    fd.append("dest", dest);
    await api.post("/upload", fd);
    debug("batchTransform", `↑ uploaded ${pdfName}`);
  } catch {
    throw new Error(`PDF not found locally: ${pdfName}`);
  }
}

/* ───────────── result type sent back to callers  */
interface Result {
  file: string;
  success: boolean;
  xml?: string;
  error?: string;
}

export async function batchTransform(
  fileNames: string[],
  readJson: (name: string) => Promise<Record<string, unknown>>,
  cache: MappingCache,
  folderHandle: FileSystemDirectoryHandle | null, // local folder for PDFs
  outDir: FileSystemDirectoryHandle | null, // optional local XML out
  api: AxiosInstance,
  level: "fast" | "normal" | "deep" = "normal",
  packageOn = true,
  zipPair = false,
  progress?: ProgressAPI
): Promise<Result[]> {
  debug("batchTransform", "▶ start –", fileNames.length, "files");

  // create a no-op fallback if progress not provided
  const silent: ProgressAPI = {
    start: () => {},
    step: () => {},
    done: () => {},
    error: () => {},
    dismiss: () => {},
    active: false,
  };
  const pr = progress ?? silent;
  pr.start(3 + fileNames.length, "Mapping JSON → Updata");
  if (fileNames.length === 0) return [];

  const STAGING = "input_local"; // backend workspace for PDFs/JSONs

  /* 1 ─ fetch Updata spec once  */
  const { data: specCtx } = await api.get("/spec");
  debug("batchTransform", "spec loaded");

  /* 2 ─ map each JSON locally, collect overrides  */
  const browserMapped: Record<string, Record<string, unknown>> = {};

  for (const fname of fileNames) {
    const json = await readJson(fname);
    const { data: mapData } = await api.post(`/map?level=${level}`, json);

    const rows = buildRows(undefined, {
      json,
      backendMapped: mapData.mapped,
      backendSuggest: mapData.suggest,
      overrides: {
        ...(cache.__template__ ?? {}),
        ...(cache[fname] ?? {}),
      } as Record<string, Override>,
      tagList: specCtx.tagList,
      orderMap: specCtx.orderMap,
      required: new Set(specCtx.required),
      conditional: new Set(specCtx.conditional),
      parentReq: new Set(specCtx.parentReq),
      parentOpt: new Set(specCtx.parentOpt),
    });

    const { mapped } = applyMapping(rows);
    browserMapped[fname] = mapped;
    debug(
      "batchTransform",
      `[map] ${fname} →`,
      Object.keys(mapped).length,
      "tags"
    );
  }

  /* 2-b ─ upload each needed PDF once  */
  if (folderHandle) {
    debug("batchTransform", "⏫ ensuring PDFs on backend");
    for (const fname of fileNames) {
      const stem = fname.replace(/\.json$/i, "");
      const pdf = `${stem}.pdf`; // original disk name
      await uploadPdfIfNeeded(api, folderHandle, pdf, STAGING);
      pr.step("Uploading PDFs");
    }
  } else {
    debug(
      "batchTransform",
      "⚠ no folder handle – PDFs must already be on server"
    );
  }

  /* helper – write XML locally (optional) */
  const writeXmlLocally = async (file: string, xml: string) => {
    if (!outDir) return;
    const outName = file.replace(/\.json$/i, ".xml");
    const h = await outDir.getFileHandle(outName, { create: true });
    const w = await h.createWritable();
    await w.write(xml);
    await w.close();
    debug("batchTransform", `💾 wrote ${outName} locally`);
  };

  /* 3 ─ FAST PATH ─ /batch_build  */
  try {
    pr.step("Building XML on server");
    const buildBody: any = {
      fileNames,
      overrides: cache,
      outDir: outDir ? "__client__" : undefined,
      browserMapped,
      package: packageOn,
      zipPair,
    };

    // only when we DID upload PDFs (folderHandle !== null)
    if (folderHandle) buildBody.inDir = STAGING;

    const { data } = await api.post("/batch_build", buildBody);

    pr.done("Finished");

    debug("batchTransform", "✓ /batch_build OK");
    for (const r of data.results as Result[]) {
      if (r.success && r.xml) await writeXmlLocally(r.file, r.xml);
      pr.step(`Server build (${r.file})`);
    }
    return data.results as Result[];
  } catch (err) {
    debug("batchTransform", "⚠ /batch_build failed – fallback", err);
    pr.error(String(err));
  }

  /* 4 ─ FALLBACK ─ build in-browser  */
  const results: Result[] = [];
  for (const fname of fileNames) {
    try {
      const { data: xml } = await api.post("/build", {
        mapped: browserMapped[fname],
      });
      await writeXmlLocally(fname, xml);
      results.push({ file: fname, success: true, xml });
    } catch (e: any) {
      results.push({ file: fname, success: false, error: String(e) });
    }
  }
  debug("batchTransform", "⬅ fallback complete –", results.length, "files");
  pr.done();
  return results;
}
