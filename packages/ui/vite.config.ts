import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The viewer's data always comes from the Bun server that fronts the CLI. In
// dev, Vite proxies to it so the client code is identical in both modes.
const API_TARGET = process.env.WAYFUL_VIEWER_API ?? "http://127.0.0.1:7830";

// Vite refuses requests for hostnames it does not know, which blocks reaching a
// dev server running on another machine. Opt in explicitly rather than by
// default: `WAYFUL_VIEWER_HOSTS=box.local,*.ts.net bun run dev`.
const ALLOWED_HOSTS = process.env.WAYFUL_VIEWER_HOSTS?.split(",").filter(Boolean) ?? [];

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 7831,
    allowedHosts: [...ALLOWED_HOSTS, "dev.taild544b4.ts.net"],
    proxy: {
      // SSE needs the proxy to stay open, so buffering is off for /api.
      "/api": { target: API_TARGET, changeOrigin: true, ws: false },
    },
  },
});
