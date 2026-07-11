import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

// Dev server proxies /api to the local abl-serve process (default port 4477,
// overridable so `pnpm --filter @abl/web dev` can point at a differently
// configured server without editing this file).
const apiTarget = process.env.ABL_API_PROXY_TARGET ?? "http://127.0.0.1:4477"

export default defineConfig({
  plugins: [solid()],
  server: {
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
  build: {
    // Served by @abl/server's withStaticDashboard from packages/web/dist —
    // see packages/server/src/main.ts.
    outDir: "dist",
    sourcemap: true,
  },
})
