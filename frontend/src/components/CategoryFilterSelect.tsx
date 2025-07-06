import { Select, MenuItem, Checkbox, ListItemText } from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";

export type Cat = "M" | "C" | "O" | "P";
const CODES: Cat[] = ["M", "C", "O", "P"];

interface Props {
  selected: Cat[];
  onChange: (cats: Cat[]) => void;
}

export default function CategoryFilterSelect({ selected, onChange }: Props) {
  const handle = (e: SelectChangeEvent<Cat[]>) => {
    const val =
      typeof e.target.value === "string"
        ? (e.target.value.split(",") as Cat[])
        : (e.target.value as Cat[]);
    onChange(val);
  };

  return (
    <Select
      multiple
      size="small"
      variant="standard"
      value={selected}
      onChange={handle}
      renderValue={(sel) =>
        sel.length === 0 ? "All" : (sel as Cat[]).join(",")
      }
      sx={{ minWidth: 70 }}
    >
      {CODES.map((code) => (
        <MenuItem key={code} value={code}>
          <Checkbox size="small" checked={selected.indexOf(code) > -1} />
          <ListItemText primary={code} />
        </MenuItem>
      ))}
    </Select>
  );
}
