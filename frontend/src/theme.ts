import { createTheme } from "@mui/material/styles";

// Define a new, vibrant dark theme. This centralizes all color and component
// styling decisions, making the app's look and feel consistent.
export const darkTheme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: "#64b5f6", // A nice, visible blue
    },
    secondary: {
      main: "#f48fb1", // A contrasting pink for key actions
    },
    background: {
      default: "#212121", // Dark grey background
      paper: "#333333", // Slightly lighter for surfaces like cards and panes
    },
    warning: {
      main: "#ffb74d", // An orange for warnings or special toggles
    },
  },
  components: {
    // Override component styles for better contrast and aesthetics
    MuiTextField: {
      styleOverrides: {
        root: {
          // Make the search bar and other text fields lighter and more visible
          "& .MuiOutlinedInput-root": {
            backgroundColor: "rgba(255, 255, 255, 0.09)",
            "&:hover .MuiOutlinedInput-notchedOutline": {
              borderColor: "#64b5f6", // Use primary color on hover
            },
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8, // Softer corners for all buttons
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          // Ensure toggle buttons have a clear border
          borderColor: "rgba(255, 255, 255, 0.23)",
        },
      },
    },
  },
});
