import { memo, useMemo } from "react";
import {
  FixedSizeGrid as Grid,
  type GridChildComponentProps,
} from "react-window";
import { ListItemText, Box, Tooltip } from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import { useTheme } from "@mui/material/styles";

interface Props {
  files: string[];
  height: number;
  width: number;
  rowHeight?: number; // defaults 33
  current: string | null;
  selectedSet: Set<string>;
  onToggleSelection: (f: string) => void;
  onPreview: (f: string) => void;
}

// This type will be passed to every Cell as `props.data`
interface CellData {
  files: string[];
  current: string | null;
  selectedSet: Set<string>;
  onPreview: (f: string) => void;
  onToggleSelection: (f: string) => void;
  cols: number;
}

export default function VirtualFileGrid({
  files,
  height,
  width,
  rowHeight = 48,
  current,
  selectedSet,
  onPreview,
  onToggleSelection,
}: Props) {
  const cols = width > 400 ? 2 : 1;
  const columnWidth = width / cols;
  const rows = Math.ceil(files.length / cols);

  const itemData = useMemo<CellData>(
    () => ({ files, selectedSet, onPreview, onToggleSelection, cols, current }),
    [files, selectedSet, onPreview, onToggleSelection, cols, current]
  );

  // --- NEW: Cell component rewritten for new UX ---
  const Cell = memo(
    ({
      columnIndex,
      rowIndex,
      style,
      data,
    }: GridChildComponentProps<CellData>) => {
      const theme = useTheme();
      const {
        files,
        selectedSet,
        onPreview,
        onToggleSelection,
        cols,
        current,
      } = data;
      const idx = rowIndex * cols + columnIndex;
      if (idx >= files.length) return null;

      const f = files[idx];
      const isSelected = selectedSet.has(f);
      const isCurrent = current === f;

      const handleInteraction = () => {
        onPreview(f);
        onToggleSelection(f);
      };

      const getBackgroundColor = () => {
        if (isSelected) return `${theme.palette.primary.main}40`;
        return "transparent";
      };

      return (
        <Box style={style} sx={{ p: 0.5 }}>
          <Tooltip title={f} placement="top" enterDelay={1000}>
            <Box
              onClick={handleInteraction}
              sx={{
                display: "flex",
                alignItems: "center",
                height: "100%",
                width: "100%",
                cursor: "pointer",
                borderRadius: 1.5,
                border: 2,
                borderColor: isCurrent ? "primary.main" : "transparent",
                bgcolor: getBackgroundColor(),
                "&:hover": {
                  borderColor: isCurrent ? "primary.dark" : "divider",
                  backgroundColor: isSelected
                    ? `${theme.palette.primary.main}60`
                    : "action.hover",
                },
                transition: "background-color 150ms, border-color 150ms",
              }}
            >
              <ListItemText
                primary={f}
                primaryTypographyProps={{
                  sx: {
                    px: 1.5,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    fontWeight: isSelected ? "700" : "400",
                    color: isSelected ? "text.primary" : "text.secondary",
                  },
                }}
              />
              {isCurrent && <AutoAwesomeIcon color="primary" sx={{ mr: 1 }} />}
            </Box>
          </Tooltip>
        </Box>
      );
    },
    // --- NEW: Updated comparator to track all relevant state changes ---
    (prev, next) => {
      const idx = prev.rowIndex * prev.data.cols + prev.columnIndex;
      if (idx >= prev.data.files.length || idx >= next.data.files.length)
        return false;
      const f = prev.data.files[idx];
      const prevSelected = prev.data.selectedSet.has(f);
      const nextSelected = next.data.selectedSet.has(f);
      const prevCurrent = prev.data.current === f;
      const nextCurrent = next.data.current === f;

      return prevSelected === nextSelected && prevCurrent === nextCurrent;
    }
  );

  return (
    <Grid
      height={height}
      width={width}
      columnWidth={columnWidth}
      rowHeight={rowHeight}
      columnCount={cols}
      rowCount={rows}
      overscanRowCount={5}
      itemData={itemData}
      itemKey={({ columnIndex, rowIndex, data }) =>
        data.files[rowIndex * data.cols + columnIndex]
      }
    >
      {Cell}
    </Grid>
  );
}
