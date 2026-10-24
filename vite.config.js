import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: "renderer",
  base: "./",
  publicDir: here("./sim/public"),
  server: { fs: { allow: [here("./")] } },
  build: { outDir: here("./dist"), emptyOutDir: true, target: "esnext", chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ["@mujoco/mujoco", "onnxruntime-web"] },
});
