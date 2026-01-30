import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
  server: {
    port: 3000,
    proxy: {
      "/skills": { target: "http://localhost:4402", changeOrigin: true },
      "/health": { target: "http://localhost:4402", changeOrigin: true },
    },
  },
});
