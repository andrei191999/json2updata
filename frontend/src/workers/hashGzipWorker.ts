// --------------------------------------------
// Hash + Gzip worker for a single PDF stream.
// Receives a File, returns { hash, gzBlob, name }.
// --------------------------------------------

/// <reference lib="webworker" />

self.onmessage = async (ev) => {
  const buf = ev.data as ArrayBuffer; // came from main thread
  try {
    /* 1️⃣  SHA-256 */
    const hashBuf = await crypto.subtle.digest("SHA-256", buf);
    const hashArray = Array.from(new Uint8Array(hashBuf));
    const hash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    /* 2️⃣  gzip (native browser stream) */
    const gzBuf = await new Response(
      new Blob([buf]).stream().pipeThrough(new CompressionStream("gzip"))
    ).arrayBuffer();

    /* 3️⃣  return results  – gzBuf transferred back, zero-copy */
    // name is “unknown” – we only need it to preserve extension/casing
    self.postMessage({ name: "blob.pdf", hash, gzBuf }, [gzBuf]);
  } catch (err) {
    self.postMessage({ error: String(err) });
  }
};
