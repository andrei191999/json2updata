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
import { v4 as uuidv4 } from "uuid";

/* ───────────── result type sent back to callers  */
interface Result {
  file: string;
  success: boolean;
  xml?: string;
  error?: string;
}

/** simple debug helper */
const bc = (m: string, extra?: any) => debug("bt", m, extra ?? "");

export async function batchTransform(
  fileNames: string[],
  readJson: (n: string) => Promise<Record<string, unknown>>,
  cache: MappingCache,
  folderHandle: FileSystemDirectoryHandle | null,
  outDir: FileSystemDirectoryHandle | null,
  api: AxiosInstance,
  level: "fast" | "normal" | "deep" = "normal",
  packageOn = true,
  zipPair = false,
  progress?: ProgressAPI
): Promise<Result[]> {
  /* ──────────────────────────────────────────────────────────────────── */
  const pr = progress ?? {
    start: () => {},
    setLabel: () => {},
    setTotal: () => {},
    step: () => {},
    done: () => {},
    error: () => {},
    dismiss: () => {},
    active: false,
    cur: 0,
  };

  const pid = uuidv4();
  console.log(`[FRONTEND] Starting Batch Job with PID: ${pid}`);
  (progress as any)?.setCancelHandler?.(() => api.post(`/cancel/${pid}`));
  const CORES = navigator.hardwareConcurrency || 4;
  const CONC_HASH = Math.min(6, Math.max(2, CORES)); // conservative default
  const WAVE = 200;

  /* ➊ pick the run-stamp **before** hashing / uploading */
  const destDirName = Date.now().toString(36); // e.g. kolgxq
  const destDir = `pdf_storage/pdf_hard_links/${destDirName}`;

  // app-level crash breadcrumbs (once)
  if (!(window as any).__btHooksInstalled) {
    (window as any).__btHooksInstalled = true;
    window.addEventListener("error", (e) =>
      bc("window:error", {
        msg: e.message,
        src: e.filename,
        line: e.lineno,
        col: e.colno,
      })
    );
    window.addEventListener("unhandledrejection", (e) =>
      bc("window:unhandledrejection", { reason: String(e.reason) })
    );
  }

  function heap() {
    const m: any = (performance as any).memory;
    return m
      ? `${(m.usedJSHeapSize / 1048576).toFixed(0)}MB/${(
          m.jsHeapSizeLimit / 1048576
        ).toFixed(0)}MB`
      : "n/a";
  }

  function callWorker<T>(
    worker: Worker,
    msg: any,
    transfer?: Transferable[],
    timeoutMs = 60_000
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const onMsg = (ev: MessageEvent<any>) => {
        worker.removeEventListener("message", onMsg);
        worker.removeEventListener("error", onErr);
        worker.removeEventListener("messageerror", onME);
        clearTimeout(t);
        const d = ev.data;
        if (d && d.error) reject(new Error(d.error));
        else resolve(d as T);
      };
      const onErr = (e: ErrorEvent) => {
        worker.removeEventListener("message", onMsg);
        worker.removeEventListener("error", onErr);
        worker.removeEventListener("messageerror", onME);
        clearTimeout(t);
        reject(new Error("worker:error " + e.message));
      };
      const onME = (e: MessageEvent) => {
        worker.removeEventListener("message", onMsg);
        worker.removeEventListener("error", onErr);
        worker.removeEventListener("messageerror", onME);
        clearTimeout(t);
        reject(new Error("worker:messageerror" + e.data));
      };
      worker.addEventListener("message", onMsg);
      worker.addEventListener("error", onErr);
      worker.addEventListener("messageerror", onME);
      const t = setTimeout(() => {
        worker.removeEventListener("message", onMsg);
        worker.removeEventListener("error", onErr);
        worker.removeEventListener("messageerror", onME);
        reject(new Error("worker:timeout"));
      }, timeoutMs);

      worker.postMessage(msg, transfer ?? []);
    });
  }

  /* ------------------------------------------------------------------
   *  A.  Map every JSON  (100-item slices, runs fully in RAM)
     ------------------------------------------------------------------ */
  const { data: specCtx } = await api.get("/spec", {
    signal: progress?.signal,
  });
  bc("spec:loaded");

  const MAP_SLICE = 100;
  const browserMapped: Record<string, any> = {};
  pr.start(fileNames.length, "Mapping JSON → Updata");

  for (let i = 0; i < fileNames.length; i += MAP_SLICE) {
    const names = fileNames.slice(i, i + MAP_SLICE);
    const jsonArr = await Promise.all(names.map(readJson));
    const t0 = performance.now();
    const { data: mappedArr } = await api.post(`/map?level=${level}`, jsonArr, {
      signal: progress?.signal,
    });

    mappedArr.forEach((mapData: any, idx: number) => {
      const fname = names[idx];
      const rows = buildRows(undefined, {
        json: jsonArr[idx],
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
      browserMapped[fname] = applyMapping(rows).mapped;
      pr.step();
    });
    bc("map:slice", {
      slice: `${i + 1}-${i + names.length}`,
      ms: (performance.now() - t0) | 0,
      heap: heap(),
    });
  }
  pr.done(); // mapping finished

  /* ------------------------------------------------------------------
   *  B.  Hash PDFs (lane-serialized)
     ------------------------------------------------------------------ */
  if (!folderHandle) {
    bc("hash", "⚠ no folder handle – cannot hash/upload PDFs");
    throw new Error(
      "No PDF folder selected. Please select the folder that contains the PDFs."
    );
  }

  /* -------------------- hashing pool (re-used for all waves) -------------------- */
  const workerPool = Array.from(
    { length: CONC_HASH },
    () =>
      new Worker(new URL("../workers/hashGzipWorker.ts", import.meta.url), {
        type: "module",
      })
  );

  const pdfMeta: { name: string; hash: string }[] = [];
  const pdfMap = new Map<string, { name: string }>();
  const missingLocal: string[] = [];
  const SAMPLE_EVERY = 10;
  // const MAX_UP = workerPool.length;
  let hashCount = 0,
    gzCount = 0;

  pr.start(fileNames.length, "Hash PDFs");
  bc("hash:start", { files: fileNames.length, WAVE, CONC_HASH });

  let lanesHash: Promise<void>[] = Array(workerPool.length).fill(
    Promise.resolve()
  );

  // per wave
  for (let w = 0; w < fileNames.length; w += WAVE) {
    const waveNames = fileNames
      .slice(w, w + WAVE)
      .map((n) => n.replace(/\.json$/i, ".pdf"));

    waveNames.forEach((pdfName, i) => {
      const lane = i % workerPool.length;
      lanesHash[lane] = lanesHash[lane].then(async () => {
        try {
          const hFile = await folderHandle!.getFileHandle(pdfName);
          const file = await hFile.getFile();
          const buf = await file.arrayBuffer();
          const res = await callWorker<any>(
            workerPool[lane],
            { op: "hash", buf },
            [buf]
          );
          pdfMeta.push({ name: pdfName, hash: res.hash });
          pdfMap.set(res.hash, { name: pdfName });
          if (++hashCount % SAMPLE_EVERY === 0)
            bc("hash:done", { pdf: pdfName, ms: res.msHash });
          pr.step();
        } catch (e: any) {
          bc("hash:error", {
            pdf: pdfName,
            lane,
            err: e?.message ?? String(e),
          });
          missingLocal.push(pdfName);
          pr.step(); // still advance progress so the bar doesn’t stall
          return; // ← do NOT throw; let the wave continue
        }
      });
    });

    await Promise.all(lanesHash);
    lanesHash = Array(workerPool.length).fill(Promise.resolve());
    bc("heap.hash+gzip", heap());
    bc("hash:missing-local", {
      count: missingLocal.length,
      sample: missingLocal.slice(0, 10),
    });
  }
  pr.done();

  /* ------------------------------------------------------------------
   *  C.  Upload only the missing PDFs (g-zip on demand)
     ------------------------------------------------------------------ */
  pr.start(pdfMeta.length, "Uploading PDFs");

  const missing: string[] = [];
  const hashes = Array.from(pdfMap.keys());
  for (let i = 0; i < hashes.length; i += 2_000) {
    const slice = hashes.slice(i, i + 2_000);
    const { data } = await api.post("/pdf/need", slice, {
      signal: progress?.signal,
    });
    missing.push(...data.missing);
  }
  pr.setTotal(missing.length || 1);
  bc("upload:need", { missing: missing.length });

  if (missing.length === 0) {
    pr.done("Uploads skipped");
  } else {
    const lanesUp: Promise<void>[] = Array(workerPool.length).fill(
      Promise.resolve()
    );
    missing.forEach((hash, i) => {
      const lane = i % workerPool.length;
      lanesUp[lane] = lanesUp[lane].then(async () => {
        const { name: pdfName } = pdfMap.get(hash)!;
        try {
          const h = await folderHandle!.getFileHandle(pdfName);
          const f = await h.getFile();
          const buf = await f.arrayBuffer();
          const gz = await callWorker<any>(
            workerPool[lane],
            { op: "gzip", buf },
            [buf]
          );
          if (++gzCount % SAMPLE_EVERY === 0)
            bc("gzip:done", {
              pdf: pdfName,
              ms: gz.msGzip,
              gzKB: (gz.gzBytes / 1024) | 0,
            });
          const fd = new FormData();
          const gzFile = new File([gz.gzBuf], pdfName, {
            type: "application/gzip",
          });
          fd.append("file", gzFile);
          fd.append("hash", hash);
          fd.append("dest", destDirName);
          const resp = await fetch("/api/pdf", {
            method: "POST",
            body: fd,
            headers: { "x-hash": hash, "x-filename": pdfName },
            signal: progress?.signal as AbortSignal,
          });
          if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            bc("upload:error", {
              pdf: pdfName,
              status: resp.status,
              detail: text,
            });
            throw new Error(`upload /api/pdf failed ${resp.status}`);
          }
          pr.step();
        } catch (e: any) {
          bc("upload:error", { pdf: pdfName, err: e?.message ?? String(e) });
          throw e;
        }
      });
    });
    await Promise.all(lanesUp);
    bc("heap.upload", heap());
  }
  pr.done("Uploads done");

  /* ------------------------------------------------------------------
   *  D.  Link every PDF on the server
     ------------------------------------------------------------------ */
  pr.start(pdfMeta.length, "Linking PDFs");
  const LINK_CHUNK_SIZE = 100; // Process 100 links at a time
  for (let i = 0; i < pdfMeta.length; i += LINK_CHUNK_SIZE) {
    const chunk = pdfMeta.slice(i, i + LINK_CHUNK_SIZE);

    await Promise.all(
      chunk.map((p) => {
        const body = new URLSearchParams({
          hash: p.hash,
          fname: p.name,
          dest: destDirName,
        }).toString();
        return api
          .post("/pdf/link", body, {
            signal: progress?.signal,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
          })
          .catch((e) => {
            // This makes linking errors much more visible in the console
            console.error(
              `[bt] LINK FAILED for ${p.name}:`,
              e.response?.data ?? e.message
            );
          })
          .then(() => pr.step()); // Advance the progress bar after each link
      })
    );

    // Optional: Log progress after each chunk
    debug(
      "link:chunk",
      `Processed ${i + chunk.length} of ${pdfMeta.length} links`
    );
  }

  pr.done("PDFs ready");

  /* ------------------------------------------------------------------
   E. Build XML with server-side streaming progress
   ------------------------------------------------------------------ */
  pr.start(fileNames.length, "Building XML on server");

  /* open WebSocket *before* triggering build */
  const ws = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${
      location.host
    }/api/stream/${pid}`
  );

  let prev = 0; // <- remembers last reported “done”
  ws.onmessage = (ev) => {
    const { done, total } = JSON.parse(ev.data);
    pr.setTotal(total); // update max if server adapts
    pr.step("", done - prev); // advance only by the delta
    prev = done;
  };

  ws.onerror = () => console.warn("progress WS error – continuing silently");
  ws.onclose = () => pr.done(); // guarantee bar reaches 100 %

  /* kick off the build */
  const buildBody: Record<string, unknown> = {
    fileNames,
    // inDir: inputDir,
    // outDir: outputDir,
    overrides: cache,
    browserMapped,
    package: packageOn,
    zipPair: zipPair && packageOn,
    pdfLinkDest: destDirName,
  };
  buildBody.missingLocal = missingLocal;
  // Keep inDir for legacy (JSON read), but pass the PDF hard-link dir explicitly.
  if (folderHandle) {
    buildBody.inDir = "__client__"; // JSONs are provided via browserMapped
    buildBody.pdfDir = destDir; // <- used by the backend to locate linked PDFs
  }

  if (outDir) buildBody.outDir = "__client__";

  /* helper – optional local XML copy */
  const writeXmlLocally = async (fname: string, xml: string) => {
    if (!outDir) return;
    const h = await outDir.getFileHandle(fname.replace(/\.json$/i, ".xml"), {
      create: true,
    });
    const w = await h.createWritable();
    await w.write(xml);
    await w.close();
  };
  const { data } = await api.post(`/batch_build?pid=${pid}`, buildBody, {
    signal: progress?.signal,
  });

  /* optional local copy */
  for (const r of data.results as Result[]) {
    if (r.success && r.xml) await writeXmlLocally(r.file, r.xml);
  }

  workerPool.forEach((w) => w.terminate());
  ws.close(); // close the WebSocket
  return data.results as Result[];
}
