import { useState, useCallback } from "react";
import { api } from "../api";

export function useFolder() {
  const [files, setFiles] = useState<string[]>([]);
  const [dir, setDir] = useState<FileSystemDirectoryHandle | null>(null);

  /* ❶ fetch default list from backend once (server-side /input) */
  useState(() => {
    api.get("/files").then((r) => setFiles(r.data));
  });

  /* ❷ let the user pick any local folder – *no uploads here* */
  const pick = useCallback(async () => {
    if (!window.showDirectoryPicker) {
      alert("Directory picker not supported in this browser.");
      return;
    }
    const handle = await window.showDirectoryPicker();
    setDir(handle);

    const localJson: string[] = [];
    for await (const entry of handle.values()) {
      if (entry.kind === "file" && entry.name.endsWith(".json")) {
        localJson.push(entry.name);
      }
    }
    setFiles(localJson);
  }, []);

  /* ❸ read JSON locally for instant preview */
  const read = useCallback(
    async (name: string) => {
      if (dir) {
        const file = await dir.getFileHandle(name).then((h) => h.getFile());
        return JSON.parse(await file.text());
      }
      /* fallback to server copy */
      const { data } = await api.get(`/file/${name}`);
      return data;
    },
    [dir]
  );

  return {
    files, // list of *.json in the chosen folder (or server /input)
    pick, // directory picker
    read, // JSON reader (local or server)
    folderHandle: dir, // expose the handle for later on-demand uploads
    folderId: dir ? "__client__" : "__server__", // tell backend no PDFs yet
  };
}
