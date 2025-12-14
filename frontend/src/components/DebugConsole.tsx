import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Tabs,
  Tab,
  TextField,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  ToggleButtonGroup,
  ToggleButton,
  Divider,
} from "@mui/material";
import {
  Close,
  Fullscreen,
  FullscreenExit,
  Clear,
  Search,
  ExpandMore,
  Wifi,
  BugReport,
  Error as ErrorIcon,
  BugReport as DebugIcon,
  Info,
  Warning,
} from "@mui/icons-material";
import { Rnd, type RndResizeCallback, type RndDragCallback } from "react-rnd";
import {
  List,
  AutoSizer,
  CellMeasurer,
  CellMeasurerCache,
} from "react-virtualized";

import {
  getLevelColor,
  formatTime,
  type LogEntry,
  type LogLevel,
} from "../utils/logHelpers";
import {
  useFilteredLogs,
  useGroupedByFile,
  useLogCounts,
  useUniqueTags,
} from "../utils/logFilters";
import { useDebugLogs } from "./DebugLogContext";
import { useLocalStorageState } from "../hooks/useLocalStorageState";

// --- High-Contrast Color Palette (Tokyo Night theme) ---
const colors = {
  bg: "#1a1b26",
  bgLight: "#24283b",
  fg: "#c0caf5",
  comment: "#08a348ff",
  cyan: "#7dcfff",
  green: "#9ece6a",
  orange: "#ff9e64",
  pink: "#f7768e",
  purple: "#bb9af7",
  red: "#f7768e",
  yellow: "#e0af68",
};

// --- Log Row Component (with new colors) ---
const LogRow = React.memo(
  ({
    log,
    isExpanded,
    onToggle,
    onTagClick,
  }: {
    log: LogEntry;
    isExpanded: boolean;
    onToggle: () => void;
    onTagClick: (tag: string) => void;
  }) => {
    const header = (
      <Box
        onClick={onToggle}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          py: 0.5,
          px: 1,
          cursor: "pointer",
          "&:hover": { bgcolor: colors.bgLight },
        }}
      >
        <Typography
          component="span"
          sx={{
            color: getLevelColor(log.level, colors),
            fontWeight: "bold",
            minWidth: "65px",
            fontFamily: "monospace",
            fontSize: "0.8rem",
          }}
        >
          {log.level}
        </Typography>
        <Typography
          component="span"
          sx={{
            color: colors.comment,
            minWidth: "80px",
            fontFamily: "monospace",
            fontSize: "0.8rem",
          }}
        >
          {formatTime(log.timestamp)}
        </Typography>
        <Tooltip title="Click to filter by this tag">
          <Chip
            label={log.tag}
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onTagClick(log.tag);
            }}
            sx={{
              height: "20px",
              fontSize: "0.75rem",
              mr: 1,
              cursor: "pointer",
              bgcolor: colors.bgLight,
              color: colors.purple,
              "&:hover": { bgcolor: colors.comment },
            }}
          />
        </Tooltip>
        {/* Compact preview of the message */}
        <Typography
          component="span"
          sx={{
            flex: 1,
            color: colors.fg,
            fontFamily: "monospace",
            fontSize: "0.85rem",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={log.message}
        >
          {log.message}
        </Typography>
        <Typography
          component="span"
          sx={{ color: colors.comment, fontFamily: "monospace", ml: 1 }}
        >
          {isExpanded ? "▲" : "▼"}
        </Typography>
      </Box>
    );

    return (
      <Box
        sx={{
          borderBottom: `1px solid ${colors.bgLight}`,
          px: 0,
        }}
      >
        {header}
        {isExpanded && (
          <Box sx={{ px: 2, pb: 1 }}>
            {/* Full message + optional extras if present */}
            <Typography
              component="pre"
              sx={{
                m: 0,
                color: colors.fg,
                fontFamily: "monospace",
                fontSize: "0.85rem",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {log.message}
            </Typography>
            {/* If your backend sends extra fields (e.g., fileName), show them */}
            {log.fileName && (
              <Typography
                sx={{ mt: 0.5, color: colors.comment, fontSize: "0.75rem" }}
              >
                file: {log.fileName}
              </Typography>
            )}
          </Box>
        )}
      </Box>
    );
  }
);

// --- Main Console Component ---
export default function DebugConsole({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { logs, clear, isConnected } = useDebugLogs();

  // --- State with Persistence ---
  const [size, setSize] = useLocalStorageState("debug-console-size", {
    width: 800,
    height: 600,
  });
  const [position, setPosition] = useLocalStorageState("debug-console-pos", {
    x: window.innerWidth - 820,
    y: 50,
  });
  const [activeTab, setActiveTab] = useLocalStorageState(
    "debug-console-tab",
    2
  );
  const [searchTerm, setSearchTerm] = useLocalStorageState(
    "debug-console-search",
    ""
  );
  const [activeLevels, setActiveLevels] = useLocalStorageState<Set<LogLevel>>(
    "debug-console-levels",
    new Set(["DEBUG", "INFO", "WARNING", "ERROR"])
  );
  const [activeTags, setActiveTags] = useLocalStorageState<Set<string>>(
    "debug-console-tags",
    new Set()
  );

  // --- Non-persistent state ---
  const [isMaximized, setIsMaximized] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // --- Derived Data and Refs ---
  const counts = useLogCounts(logs);
  const uniqueTags = useUniqueTags(logs);
  const filteredLogs = useFilteredLogs(
    logs,
    searchTerm,
    activeTab,
    activeLevels,
    activeTags
  );
  const groupedLogs = useGroupedByFile(filteredLogs, activeTab === 0);

  // --- Refs for managing the virtualized list and RND component ---
  const rndRef = useRef<Rnd>(null);
  const listRef = useRef<List>(null);
  const preMaximizeState = useRef({ x: 0, y: 0, width: 800, height: 600 });
  const cache = useRef(
    new CellMeasurerCache({ fixedWidth: true, defaultHeight: 25 })
  );
  const toggleFile = useCallback((fileName: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      next.has(fileName) ? next.delete(fileName) : next.add(fileName);
      return next;
    });
  }, []);
  const toggleRowExpanded = useCallback((rowKey: string, rowIndex?: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(rowKey) ? next.delete(rowKey) : next.add(rowKey);
      return next;
    });
    // Bust the measurement cache for this row so it can grow/shrink
    if (typeof rowIndex === "number") {
      cache.current.clear(rowIndex, 0);
      listRef.current?.recomputeRowHeights(rowIndex);
    } else {
      cache.current.clearAll();
      listRef.current?.recomputeRowHeights(0);
    }
  }, []);

  const handleLevelChange = (_event: React.MouseEvent, newLevels: LogLevel[]) =>
    setActiveLevels(new Set(newLevels || []));
  const handleTagToggle = (tag: string) => {
    const newTags = new Set(activeTags);
    newTags.has(tag) ? newTags.delete(tag) : newTags.add(tag);
    setActiveTags(newTags);
  };
  const handleTagClick = (tag: string) => setSearchTerm(`tag:${tag}`);

  const handleDragStop: RndDragCallback = (_e, d) => {
    console.log("DRAG STOP - New Position:", { x: d.x, y: d.y });
    setPosition({ x: d.x, y: d.y });
  };

  const handleResizeStop: RndResizeCallback = (_e, _dir, ref, _delta, pos) => {
    const newSize = {
      width: parseInt(ref.style.width, 10),
      height: parseInt(ref.style.height, 10),
    };
    console.log("RESIZE STOP - New Size:", newSize, "New Position:", pos);
    setSize(newSize);
    setPosition(pos);
  };

  const handleMaximize = useCallback(() => {
    setIsMaximized((prev) => {
      const next = !prev;

      if (next) {
        // going *into* maximised mode
        preMaximizeState.current = { ...position, ...size };

        const w = Math.round(window.innerWidth * 0.9);
        const h = Math.round(window.innerHeight * 0.9);

        setSize({ width: w, height: h });
        setPosition({
          x: Math.round((window.innerWidth - w) / 2),
          y: Math.round((window.innerHeight - h) / 2),
        });
      } else {
        // restoring previous geometry
        const { x, y, width, height } = preMaximizeState.current;
        setSize({ width, height });
        setPosition({ x, y });
      }

      return next;
    });
  }, [position, size]);

  useEffect(() => {
    cache.current.clearAll();
    listRef.current?.recomputeRowHeights(0);
  }, [filteredLogs, activeTab, size]);

  const reversedLogs = React.useMemo(
    () => [...filteredLogs].reverse(),
    [filteredLogs]
  );

  const rowRenderer = ({ index, key, style, parent }: any) => {
    const log = reversedLogs[index];
    const rowKey = `${log.timestamp}-${log.tag}-${index}`; // stable enough
    const isExpanded = expandedRows.has(rowKey);
    return (
      <CellMeasurer
        cache={cache.current}
        columnIndex={0}
        key={key}
        parent={parent}
        rowIndex={index}
      >
        <div style={style}>
          <LogRow
            log={log}
            isExpanded={isExpanded}
            onToggle={() => toggleRowExpanded(rowKey, index)}
            onTagClick={handleTagClick}
          />
        </div>
      </CellMeasurer>
    );
  };

  if (!open) return null;

  return (
    <Rnd
      ref={rndRef}
      size={size}
      position={position}
      onDragStop={handleDragStop}
      onResizeStop={handleResizeStop}
      minWidth={500}
      minHeight={400}
      bounds="window"
      dragHandleClassName="drag-handle"
      enableResizing={true}
      disableDragging={false}
      style={{ zIndex: 1400 }}
    >
      <Paper
        elevation={12}
        sx={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          bgcolor: colors.bg,
          color: colors.fg,
          border: `1px solid ${colors.bgLight}`,
          borderRadius: "8px",
        }}
      >
        {/* Header */}
        <Box
          className="drag-handle"
          sx={{
            display: "flex",
            alignItems: "center",
            p: "4px 8px",
            bgcolor: "#1e2127",
            color: "#fff",
            cursor: isMaximized ? "default" : "move",
          }}
        >
          <BugReport sx={{ mr: 1, color: colors.cyan }} />
          <Typography sx={{ flexGrow: 1 }}>Debug Console</Typography>
          <Tooltip title={isConnected ? "Connected" : "Disconnected"}>
            <IconButton size="small" color="inherit">
              <Wifi sx={{ color: isConnected ? colors.green : colors.red }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Clear logs">
            <IconButton size="small" color="inherit" onClick={clear}>
              <Clear sx={{ color: colors.fg }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={isMaximized ? "Restore" : "Maximize"}>
            <IconButton size="small" color="inherit" onClick={handleMaximize}>
              {isMaximized ? (
                <FullscreenExit sx={{ color: colors.fg }} />
              ) : (
                <Fullscreen sx={{ color: colors.fg }} />
              )}
            </IconButton>
          </Tooltip>
          <Tooltip title="Close">
            <IconButton size="small" color="inherit" onClick={onClose}>
              <Close sx={{ color: colors.fg }} />
            </IconButton>
          </Tooltip>
        </Box>

        <Box sx={{ p: 1, borderBottom: 1, borderColor: colors.bgLight }}>
          <TextField
            fullWidth
            size="small"
            placeholder="Search or use 'tag:tagName'"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            sx={{
              "& .MuiInputBase-root": {
                bgcolor: colors.bgLight,
                color: colors.fg,
              },
              "& .MuiOutlinedInput-notchedOutline": {
                borderColor: colors.comment,
              },
            }}
            InputProps={{
              startAdornment: <Search sx={{ mr: 1, color: colors.comment }} />,
            }}
          />
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mt: 1,
            }}
          >
            <Tabs
              value={activeTab}
              onChange={(_, v) => setActiveTab(v)}
              sx={{
                minHeight: "auto",
                "& .MuiTab-root": { color: colors.comment },
                "& .Mui-selected": { color: colors.cyan },
                "& .MuiTabs-indicator": { bgcolor: colors.cyan },
              }}
            >
              <Tab label={`Files (${counts.files})`} />
              <Tab label={`System (${counts.system})`} />
              <Tab label={`All (${counts.all})`} />
            </Tabs>
            <ToggleButtonGroup
              value={Array.from(activeLevels)}
              onChange={handleLevelChange}
              size="small"
              sx={{
                "& .MuiToggleButton-root": {
                  borderColor: colors.comment,
                  "&:not(.Mui-selected)": { opacity: 0.5 },
                },
              }}
            >
              <ToggleButton value="DEBUG">
                <Tooltip title="Debug">
                  <DebugIcon
                    sx={{ color: colors.comment, fontSize: "1.25rem" }}
                  />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="INFO">
                <Tooltip title="Info">
                  <Info sx={{ color: colors.cyan, fontSize: "1.25rem" }} />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="WARNING">
                <Tooltip title="Warning">
                  <Warning sx={{ color: colors.orange, fontSize: "1.25rem" }} />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="ERROR">
                <Tooltip title="Error">
                  <ErrorIcon sx={{ color: colors.red, fontSize: "1.25rem" }} />
                </Tooltip>
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <Divider sx={{ my: 1, borderColor: colors.bgLight }} />
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
            {uniqueTags.map((tag) => (
              <Chip
                key={tag}
                label={tag}
                size="small"
                onClick={() => handleTagToggle(tag)}
                sx={{
                  color: colors.fg,
                  bgcolor: activeTags.has(tag) ? colors.purple : colors.bgLight,
                  "&:hover": { bgcolor: colors.comment },
                }}
              />
            ))}
            {activeTags.size > 0 && (
              <Chip
                label="Clear Tags"
                size="small"
                onClick={() => setActiveTags(new Set())}
                variant="outlined"
                sx={{ borderColor: colors.comment, color: colors.comment }}
              />
            )}
          </Box>
        </Box>

        {/* Log Content Area */}
        <Box sx={{ flex: 1, overflow: "hidden" }}>
          {activeTab === 0 ? (
            <Box sx={{ p: 1, height: "100%", overflowY: "auto" }}>
              {Object.entries(groupedLogs).map(([fileName, fileLogs]) => (
                <Accordion
                  key={fileName}
                  expanded={expandedFiles.has(fileName)}
                  onChange={() => toggleFile(fileName)}
                  disableGutters
                  elevation={0}
                  sx={{
                    bgcolor: colors.bgLight,
                    color: colors.fg,
                    "&:before": { display: "none" },
                  }}
                >
                  <AccordionSummary
                    expandIcon={<ExpandMore sx={{ color: colors.comment }} />}
                  >
                    <Typography>
                      📄 {fileName} ({fileLogs.length})
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails
                    sx={{
                      p: 0,
                      maxHeight: "400px",
                      overflowY: "auto",
                      borderTop: 1,
                      borderColor: colors.bgLight,
                      bgcolor: colors.bg,
                    }}
                  >
                    {fileLogs
                      .slice()
                      .reverse()
                      .map((log, index) => (
                        <LogRow
                          log={log}
                          isExpanded={expandedRows.has(
                            `${log.timestamp}-${log.tag}-${index}`
                          )}
                          onToggle={() =>
                            toggleRowExpanded(
                              `${log.timestamp}-${log.tag}-${index}`
                            )
                          }
                          onTagClick={handleTagClick}
                        />
                      ))}
                  </AccordionDetails>
                </Accordion>
              ))}
            </Box>
          ) : (
            <AutoSizer>
              {({ height, width }) => (
                <List
                  ref={listRef}
                  height={height}
                  width={width}
                  rowCount={reversedLogs.length}
                  rowHeight={cache.current.rowHeight}
                  rowRenderer={rowRenderer}
                  deferredMeasurementCache={cache.current}
                  overscanRowCount={10}
                />
              )}
            </AutoSizer>
          )}
          {filteredLogs.length === 0 && (
            <Typography
              sx={{ textAlign: "center", color: "text.secondary", mt: 4 }}
            >
              No Logs to Display
            </Typography>
          )}
        </Box>
      </Paper>
    </Rnd>
  );
}
