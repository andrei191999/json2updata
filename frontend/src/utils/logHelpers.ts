/**
 * Utilities reused by DebugLogProvider and DebugConsole
 */
export type LogLevel = "DEBUG" | "INFO" | "WARNING" | "ERROR";

export interface LogEntry {
  level: LogLevel;
  tag: string;
  message: string;
  timestamp: number;
  fileName?: string;
}

/* ----- parsing helpers -------------------------------------------------- */

/**
 * Extract `<file>.json` from typical mapper log lines.
 * This version is more robust and will find any word that ends in .json,
 * whether it's in brackets or not.
 */
export const extractFileName = (msg: string): string | undefined => {
  const match = msg.match(/\b[\w-]+\.json\b/);
  if (match) {
    return match[0];
  }
  return undefined;
};

/** Map log level → colour hex */
export const getLevelColor = (
  level: LogLevel,
  // Pass the color palette to use for the theme
  colors: { red: string; orange: string; cyan: string; comment: string }
) => {
  switch (level) {
    case "ERROR":
      return colors.red;
    case "WARNING":
      return colors.orange;
    case "INFO":
      return colors.cyan;
    case "DEBUG":
    default:
      return colors.comment;
  }
};

/** Unix-seconds → locale time like `14:03:09` */
export const formatTime = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString();
