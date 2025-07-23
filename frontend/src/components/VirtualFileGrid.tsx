import React, { memo, useMemo } from "react";
import {
  FixedSizeGrid as Grid,
  type GridChildComponentProps,
} from "react-window";
import { Checkbox, ListItemText, Box, ListItemIcon } from "@mui/material";

interface Props {
  files: string[];
  height: number;
  width: number;
  rowHeight?: number; // defaults 28
  current: string | null;
  selectedSet: Set<string>;
  onToggle: (f: string, c: boolean) => void;
  onPreview: (f: string) => void;
}

// This type will be passed to every Cell as `props.data`
interface CellData {
  files: string[];
  selectedSet: Set<string>;
  onToggle: (f: string, c: boolean) => void;
  onPreview: (f: string) => void;
  cols: number;
}

export default function VirtualFileGrid({
  files,
  height,
  width,
  rowHeight = 33,
  current,
  selectedSet,
  onToggle,
  onPreview,
}: Props) {
  const cols = 2; // 🔸 fixed two-column grid
  const columnWidth = width / cols; // 50 % of available space
  const rows = Math.ceil(files.length / cols);
  // We pass everything the Cell needs down as `itemData`
  const itemData = useMemo<CellData>(
    () => ({ files, selectedSet, onToggle, onPreview, cols }),
    [files.length, selectedSet, onToggle, onPreview, cols]
  );
  const Cell = memo(
    ({
      columnIndex,
      rowIndex,
      style,
      data,
    }: GridChildComponentProps<CellData>) => {
      const { files, selectedSet, onToggle, onPreview, cols } = data;
      const idx = rowIndex * cols + columnIndex;
      if (idx >= files.length) return null;
      const f = files[idx];
      const checked = selectedSet.has(f);
      const isPreview = f === current;

      return (
        <Box
          component="div"
          style={style}
          sx={{
            px: 1,
            display: "flex",
            alignItems: "center",
            bgcolor: isPreview ? "rgba(0,0,200,0.08)" : "transparent",
            "&:hover": { bgcolor: "rgba(0,0,0,0.04)" },
          }}
          onClick={() => onPreview(f)}
        >
          <ListItemIcon sx={{ minWidth: 32 }}>
            <Checkbox
              disableRipple
              edge="start"
              size="small"
              checked={checked}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onToggle(f, e.target.checked)}
            />
          </ListItemIcon>
          <ListItemText
            primary={f}
            sx={{
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              cursor: "pointer",
            }}
          />
        </Box>
      );
    },
    // custom comparator: only re-render if this cell’s own checked changed
    (prev, next) => {
      const idx = prev.rowIndex * prev.data.cols + prev.columnIndex;
      const f = prev.data.files[idx];
      const prevChecked = prev.data.selectedSet.has(f);
      const nextChecked = next.data.selectedSet.has(f);
      return prevChecked === nextChecked;
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
      itemData={itemData} // inject our data into every Cell
      itemKey={
        ({ columnIndex, rowIndex, data }) =>
          data.files[rowIndex * data.cols + columnIndex] // stable filename key
      }
    >
      {Cell}
    </Grid>
  );
}
