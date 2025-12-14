// --------------------------------------------
// Hash + Gzip worker for a single PDF stream.
// Receives a File, returns { hash, gzBlob, name }.
// --------------------------------------------

/// <reference lib="webworker" />

type Msg = { op: "hash"; buf: ArrayBuffer } | { op: "gzip"; buf: ArrayBuffer };

function u8(buf: ArrayBuffer) {
  return new Uint8Array(buf);
}

async function sha256(buf: ArrayBuffer) {
  const t0 = performance.now();
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  const hashArray = Array.from(new Uint8Array(hashBuf));
  const hash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return { hash, msHash: performance.now() - t0 };
}

async function gzipBuf(buf: ArrayBuffer) {
  const t0 = performance.now();
  const gz = await new Response(
    new Blob([buf]).stream().pipeThrough(new CompressionStream("gzip"))
  ).arrayBuffer();
  return {
    gzBuf: gz,
    gzBytes: u8(gz).byteLength,
    msGzip: performance.now() - t0,
  };
}

self.addEventListener("message", async (ev: MessageEvent<Msg>) => {
  try {
    const msg = ev.data as any;
    if (msg && msg.op === "hash") {
      const out = await sha256(msg.buf);
      (self as any).postMessage(out);
      return;
    }
    if (msg && msg.op === "gzip") {
      const out = await gzipBuf(msg.buf);
      (self as any).postMessage(out, [out.gzBuf]);
      return;
    }
    (self as any).postMessage({ error: "bad-op" });
  } catch (err) {
    (self as any).postMessage({ error: String(err) });
  }
});

// extra breadcrumbs
self.addEventListener("messageerror", (e) => {
  (self as any).postMessage({ error: "messageerror " + String(e) });
});
self.addEventListener("error", (e: any) => {
  (self as any).postMessage({
    error: "worker:error " + String(e?.message || e),
  });
});
