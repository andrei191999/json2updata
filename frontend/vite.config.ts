import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        // This is crucial for WebSocket proxying. It changes the 'Host'
        // header of the request to match the target URL.
        changeOrigin: true,
        // This enables WebSocket proxying.
        ws: true,
        secure: false,
      },
    },
  },
});
