import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The trust console talks to the commons worker (WXP). In dev it proxies /api
// and /mcp to the local worker (npm run dev -w @workrr/commons, port 3100).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api": "http://localhost:3100",
      "/mcp": "http://localhost:3100",
    },
  },
});
