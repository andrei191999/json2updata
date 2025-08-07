import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  type PropsWithChildren,
} from "react";
import { type LogEntry, extractFileName } from "../utils/logHelpers";

// 1. Define the shape of the context value for better type safety.
interface DebugLogContextValue {
  logs: LogEntry[];
  clear: () => void;
  isConnected: boolean;
}

const DebugLogContext = createContext<DebugLogContextValue | null>(null);

const MAX_LOGS = 5_000; // The size of the ring-buffer

export const DebugLogProvider = ({ children }: PropsWithChildren) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const clear = useCallback(() => setLogs([]), []);

  // 2. The core connection logic is now inside a single useEffect hook.
  // This hook will run once on mount and handle everything.
  useEffect(() => {
    let reconnectTimeout: NodeJS.Timeout;

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/debug/stream`;

      console.log("Attempting to connect to WebSocket:", wsUrl);
      const ws = new WebSocket(wsUrl);

      // Assign the instance to the ref so it can be accessed for cleanup
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("Debug WebSocket connected");
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        if (typeof event.data !== "string" || event.data === "") return;

        try {
          const entry = JSON.parse(event.data) as LogEntry;
          const newLog: LogEntry = {
            ...entry,
            fileName: entry.fileName || extractFileName(entry.message),
          };

          setLogs((prev) => [...prev, newLog].slice(-MAX_LOGS));
        } catch (err) {
          console.warn("Debug WebSocket parse error:", err);
        }
      };

      ws.onclose = (event) => {
        console.log("Debug WebSocket closed:", event.code, event.reason);
        setIsConnected(false);

        // Auto-reconnect logic
        if (event.code !== 1000) {
          // 1000 means normal closure
          reconnectTimeout = setTimeout(connect, 3000);
        }
      };

      ws.onerror = (error) => {
        console.error("Debug WebSocket error:", error);
        // The onclose event will fire automatically after an error.
      };
    };

    // Initial connection attempt
    connect();

    // 4. The cleanup function is the single source of truth for tearing down.
    return () => {
      // Clear the timeout to prevent a reconnect attempt after the component unmounts.
      clearTimeout(reconnectTimeout);

      // Close the WebSocket connection if it's still open.
      if (wsRef.current) {
        console.log("Cleaning up WebSocket connection.");
        // We set onclose to null to prevent the reconnect logic from firing on manual close.
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, []); // The empty dependency array [] ensures this runs only once on mount.

  const contextValue: DebugLogContextValue = {
    logs,
    clear,
    isConnected,
  };

  return (
    <DebugLogContext.Provider value={contextValue}>
      {children}
    </DebugLogContext.Provider>
  );
};

// 5. The custom hook is simplified to just return the context.
export const useDebugLogs = () => {
  const context = useContext(DebugLogContext);
  if (!context) {
    throw new Error("useDebugLogs must be used within a DebugLogProvider");
  }
  return context;
};
