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

  const CORES = navigator.hardwareConcurrency || 4;
  const CONC_HASH = Math.min(16, CORES);
  const MAX_UP = Math.min(128, CORES * 4);

  /* ➊ pick the run-stamp **before** hashing / uploading */
  const destDirName = Date.now().toString(36); // e.g. kolgxq
  const destDir = `pdf_storage/pdf_hard_links/${destDirName}`;

  const { data: specCtx } = await api.get("/spec");
  debug("batchTransform", "spec loaded");

  /* ------------------------------------------------------------------
   *  A.  Map every JSON  (100-item slices, runs fully in RAM)
     ------------------------------------------------------------------ */
  const MAP_SLICE = 100;
  pr.start(fileNames.length, "Mapping JSON → Updata");

  const browserMapped: Record<string, any> = {};

  for (let i = 0; i < fileNames.length; i += MAP_SLICE) {
    const names = fileNames.slice(i, i + MAP_SLICE);
    const jsonArr = await Promise.all(names.map(readJson));

    const { data: mappedArr } = await api.post(`/map?level=${level}`, jsonArr);

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
  }
  pr.done(); // mapping finished

  /* ------------------------------------------------------------------
   *  B.  Hash + gzip PDFs in 1 000-file “waves”
     ------------------------------------------------------------------ */
  if (!folderHandle) {
    debug("batchTransform", "⚠ no folder handle – assume PDFs on server");
  }

  /* -------------------- hashing pool (re-used for all waves) -------------------- */
  const workerPool = Array.from(
    { length: CONC_HASH },
    () =>
      new Worker(new URL("../workers/hashGzipWorker.ts", import.meta.url), {
        type: "module",
      })
  );

  const pdfMeta: { name: string; hash: string; gz: Blob }[] = [];
  const pdfMap = new Map<string, { name: string; gz: Blob }>();
  const WAVE = 500;
  pr.start(fileNames.length, "Hash+Gzip PDFs");

  // simple semaphore array to cap workers
  const sem: Promise<void>[] = Array(CONC_HASH).fill(Promise.resolve());

  for (let w = 0; w < fileNames.length; w += WAVE) {
    const waveNames = fileNames
      .slice(w, w + WAVE)
      .map((n) => n.replace(/\.json$/i, ".pdf"));

    await Promise.all(
      waveNames.map(
        (pdfName, idx) =>
          (sem[idx % CONC_HASH] = sem[idx % CONC_HASH].then(async () => {
            /* ---------------- one worker job ---------------- */
            const hFile = await folderHandle!.getFileHandle(pdfName);
            const file = await hFile.getFile();

            const worker = workerPool[idx % CONC_HASH];

            const res = await new Promise<any>(async (r, j) => {
              worker.onmessage = ({ data }) =>
                data.error ? j(data.error) : r(data);
              const buf = await file.arrayBuffer();
              worker.postMessage(buf, [buf]);
            });

            const gzFile = new File([res.gzBuf], pdfName, {
              type: "application/gzip",
            });

            pdfMeta.push({ name: pdfName, hash: res.hash, gz: gzFile });
            pdfMap.set(res.hash, { name: pdfName, gz: gzFile });

            pr.step();
          }))
      )
    );
  }
  pr.done();

  /* ------------------------------------------------------------------
   *  C.  Upload only the missing PDFs
     ------------------------------------------------------------------ */
  pr.start(pdfMeta.length, "Uploading PDFs");

  // ask server which hashes it lacks
  const missing: string[] = [];
  for (let i = 0; i < pdfMeta.length; i += 2_000) {
    const slice = Array.from(pdfMap.keys()).slice(i, i + 2_000);
    const { data } = await api.post("/pdf/need", slice);
    missing.push(...data.missing);
  }

  pr.setTotal(missing.length || 1);

  if (missing.length === 0) {
    pr.done("Uploads skipped");
  } else {
    const queue = [...missing];
    await Promise.all(
      Array.from({ length: MAX_UP }, async () => {
        while (queue.length) {
          const hash = queue.pop()!;
          const p = pdfMap.get(hash)!;

          const fd = new FormData();
          /* wrap the compressed bytes in a proper File – carries a filename */
          const gzFile = new File([p.gz], p.name, { type: "application/gzip" });
          fd.append("file", gzFile);
          fd.append("hash", hash);
          fd.append("dest", destDirName);

          await api.post("/pdf", fd, {
            headers: { "Content-Type": "multipart/form-data" },
            onUploadProgress: (e) => {
              if (e.loaded === e.total) pr.step();
            },
          });
        }
      })
    );
    pr.done("Uploads done");
  }

  /* ------------------------------------------------------------------
   *  D.  Link every PDF on the server
     ------------------------------------------------------------------ */
  pr.start(pdfMeta.length, "Linking PDFs");

  await Promise.all(
    pdfMeta.map((p) => {
      const body = new URLSearchParams({
        hash: p.hash,
        fname: p.name,
        dest: destDirName,
      }).toString(); // <- serialise!

      return api
        .post("/pdf/link", body, {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        })
        .catch((e) => debug("link-fail", p.name, e.response?.data ?? e.message))
        .then(() => pr.step());
    })
  );

  pr.done("PDFs ready");

  /* ------------------------------------------------------------------
   E. Build XML with server-side streaming progress
   ------------------------------------------------------------------ */
  const pid = uuidv4();
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
    overrides: cache,
    browserMapped,
    package: packageOn,
    zipPair: zipPair && packageOn,
  };
  if (folderHandle) buildBody.inDir = destDir;
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
  const { data } = await api.post(`/batch_build?pid=${pid}`, buildBody);

  /* optional local copy */
  for (const r of data.results as Result[]) {
    if (r.success && r.xml) await writeXmlLocally(r.file, r.xml);
  }

  workerPool.forEach((w) => w.terminate());
  ws.close(); // close the WebSocket
  return data.results as Result[];
}
