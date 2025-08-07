import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { DebugLogProvider } from "./components/DebugLogContext.tsx";
import { ProgressProvider } from "./components/ProgressContext.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DebugLogProvider>
      <ProgressProvider>
        <App />
      </ProgressProvider>
    </DebugLogProvider>
  </StrictMode>
);
