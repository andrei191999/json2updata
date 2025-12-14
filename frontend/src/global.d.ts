// This file extends the global Window interface to include the File System Access API.
// By creating this file, you inform TypeScript about the 'showDirectoryPicker' method,
// resolving the error without needing to modify any other code.

interface FileSystemDirectoryHandle extends FileSystemHandle {
  kind: "directory";
  resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null>;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<FileSystemDirectoryHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<FileSystemFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  values(): AsyncIterableIterator<
    FileSystemDirectoryHandle | FileSystemFileHandle
  >;
}

interface Window {
  showDirectoryPicker?(options?: {
    id?: string;
    mode?: "read" | "readwrite";
    startIn?:
      | "desktop"
      | "documents"
      | "downloads"
      | "music"
      | "pictures"
      | "videos"
      | FileSystemHandle;
  }): Promise<FileSystemDirectoryHandle>;
}
