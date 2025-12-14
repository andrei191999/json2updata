import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { darkTheme } from "./theme"; // Import our new theme
import App from "./App.tsx";
import { DebugLogProvider } from "./components/DebugLogContext.tsx";
import { ProgressProvider } from "./components/ProgressContext.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider theme={darkTheme}>
      <DebugLogProvider>
        <CssBaseline /> {/* Apply the theme's baseline styles */}
        <ProgressProvider>
          <App />
        </ProgressProvider>
      </DebugLogProvider>
    </ThemeProvider>
  </StrictMode>
);
