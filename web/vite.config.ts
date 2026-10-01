import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The test instance has its own ports (and database, see server/src/config.ts),
// so it can never talk to the real server by mistake.
const isTest = process.env.PRIVATEKONOMI_INSTANCE === "test";
const apiPort = Number(process.env.API_PORT || (isTest ? 3101 : 3001));
// Tailscale serve (PUBLIC_BASE_URL in .env) reaches the dev server under its own
// host name: Vite must allow it, and the bank's callback (/api/…) goes on to the backend.
const env = loadEnv("development", `${import.meta.dirname}/..`, "");
const publicHost = env.PUBLIC_BASE_URL ? new URL(env.PUBLIC_BASE_URL).hostname : null;
const backend = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.WEB_PORT || (isTest ? 5174 : 5173)),
    strictPort: true,
    allowedHosts: publicHost ? [publicHost] : [],
    // /privacy and /terms: the plain pages Enable Banking links to.
    proxy: { "/api": backend, "/privacy": backend, "/terms": backend },
  },
  build: { outDir: "../dist/web", emptyOutDir: true },
});
