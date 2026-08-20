import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static app: it talks to whatever Fountain the user points it at, so there
// is no proxy in the build. In dev, either add http://localhost:5180 to
// API_CORS_ORIGINS on the Fountain server, or set FOUNTAIN_PROXY to a
// Fountain URL and the dev server forwards /api there (then enter
// http://localhost:5180 as the Fountain URL in the app and paste a key —
// OAuth redirects go to the real origin).
// VITE_BASE is the path the build is served under; unset means the root.
const proxyTarget = process.env.FOUNTAIN_PROXY?.replace(/\/+$/, "");
const appCommit = (process.env.GITHUB_SHA ?? "dev").slice(0, 7);

export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  define: { __APP_COMMIT__: JSON.stringify(appCommit) },
  plugins: [react()],
  server: {
    port: 5180,
    proxy: proxyTarget ? { "/api": { target: proxyTarget, changeOrigin: true, secure: true } } : undefined,
  },
  build: { outDir: "dist", sourcemap: true },
});
