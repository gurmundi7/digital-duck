import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// Pollen's brand marks ship with their simulator's public folder. The pet never
// shows them and must not look like it carries their branding, so drop them from the build.
const POLLEN_MARKS = ["assets/microduck-wordmark.svg", "assets/duck-head-mark.webp", "assets/duck-head-mark-open.webp"];
const dropPollenMarks = () => ({
  name: "drop-pollen-marks",
  closeBundle() { for (const f of POLLEN_MARKS) fs.rmSync(path.join(here("./dist"), f), { force: true }); },
});

export default defineConfig({
  root: "renderer",
  base: "./",
  publicDir: here("./sim/public"),
  server: { fs: { allow: [here("./")] } },
  build: { outDir: here("./dist"), emptyOutDir: true, target: "esnext", chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ["@mujoco/mujoco", "onnxruntime-web"] },
  plugins: [dropPollenMarks()],
});
