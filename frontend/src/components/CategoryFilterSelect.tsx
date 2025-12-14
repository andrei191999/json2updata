import {
  Select,
  MenuItem,
  Checkbox,
  ListItemText,
  Divider,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";

export type Cat = "M" | "C" | "O" | "P";
const CODES: Cat[] = ["M", "C", "O", "P"];

interface Props {
  selected: Cat[];
  onChange: (cats: Cat[]) => void;
}

export default function CategoryFilterSelect({ selected, onChange }: Props) {
  const handle = (e: SelectChangeEvent<Cat[]>) => {
    const value = e.target.value as string[];

    // ✅ Handle "Select All"
    if (value.includes("all")) {
      onChange(CODES);
      return;
    }
    // ✅ Handle "Deselect None"
    if (value.includes("none")) {
      onChange([]);
      return;
    }

    onChange(value as Cat[]);
  };

  return (
    <Select
      multiple
      size="small"
      variant="standard"
      value={selected}
      onChange={handle}
      renderValue={(sel) =>
        sel.length === CODES.length || sel.length === 0
          ? "All"
          : (sel as Cat[]).join(",")
      }
      sx={{ minWidth: 70 }}
    >
      <MenuItem value="all">
        <ListItemText primary="All" />
      </MenuItem>
      <MenuItem value="none">
        <ListItemText primary="None" />
      </MenuItem>
      <Divider />
      {CODES.map((code) => (
        <MenuItem key={code} value={code}>
          <Checkbox size="small" checked={selected.indexOf(code) > -1} />
          <ListItemText primary={code} />
        </MenuItem>
      ))}
    </Select>
  );
}
