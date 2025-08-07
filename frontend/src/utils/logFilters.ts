import { useMemo } from "react";
import type { LogEntry, LogLevel } from "./logHelpers";

/**
 * NEW: A dedicated hook to calculate the counts for each tab label.
 * This runs on the original, unfiltered list of logs.
 */
export const useLogCounts = (logs: LogEntry[]) => {
  return useMemo(() => {
    const fileLogs = logs.filter((l) => !!l.fileName);
    const errorLogs = logs.filter(
      (l) => l.level === "ERROR" || l.level === "WARNING"
    );

    // For the "Files" count, we want the number of *unique* files, not the total number of file logs.
    const uniqueFileNames = new Set(fileLogs.map((l) => l.fileName));

    return {
      files: uniqueFileNames.size,
      system: logs.length - fileLogs.length,
      all: logs.length,
      errors: errorLogs.length,
    };
  }, [logs]);
};

/**
 * Memoised helpers consumed by DebugConsole – keeps JSX lean.
 */
export const useFilteredLogs = (
  logs: LogEntry[],
  term: string,
  activeTab: number,
  activeLevels: Set<LogLevel>, // new
  activeTags: Set<string> // new
) =>
  useMemo(() => {
    let out = logs;

    // 1. Filter by active log levels
    if (activeLevels.size < 4) {
      // Optimization: only filter if not all levels are active
      out = out.filter((l) => activeLevels.has(l.level));
    }

    // 2. Filter by active tags
    if (activeTags.size > 0) {
      out = out.filter((l) => activeTags.has(l.tag));
    }

    // 3. Filter by search term
    if (term) {
      // Allow searching for a specific tag with "tag:tagname"
      const tagQueryMatch = term.match(/^tag:(\w+)/);
      if (tagQueryMatch) {
        const tagToSearch = tagQueryMatch[1];
        out = out.filter(
          (l) => l.tag.toLowerCase() === tagToSearch.toLowerCase()
        );
      } else {
        const q = term.toLowerCase();
        out = out.filter(
          (l) =>
            l.message.toLowerCase().includes(q) ||
            l.tag.toLowerCase().includes(q) ||
            (l.fileName && l.fileName.toLowerCase().includes(q))
        );
      }
    }

    // 4. Filter by the active tab
    switch (activeTab) {
      case 0: // Files
        return out.filter((l) => !!l.fileName);
      case 1: // System
        return out.filter((l) => !l.fileName);
      case 3: // Errors
        return out.filter((l) => l.level === "ERROR" || l.level === "WARNING");
      default: // "All" tab needs no further filtering
        return out;
    }
  }, [logs, term, activeTab, activeLevels, activeTags]);

/**
 * Groups the filtered logs by file name.
 * This is only used when the "Files" tab is active.
 */
export const useGroupedByFile = (
  logs: LogEntry[],
  enable: boolean
): Record<string, LogEntry[]> =>
  useMemo(() => {
    if (!enable) return {};
    const grouped: Record<string, LogEntry[]> = {};
    for (const log of logs) {
      if (log.fileName) {
        if (!grouped[log.fileName]) grouped[log.fileName] = [];
        grouped[log.fileName].push(log);
      }
    }
    return grouped;
  }, [logs, enable]);

/**
 * NEW: A hook to get all unique tags from the logs for the filter UI
 */
export const useUniqueTags = (logs: LogEntry[]): string[] => {
  return useMemo(() => {
    const tags = new Set(logs.map((l) => l.tag));
    return Array.from(tags).sort();
  }, [logs]);
};
