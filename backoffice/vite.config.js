import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
import { sharedDir, sharedResolve } from "../shared/vite.shared.js";

export default defineConfig({
  plugins: [react()],
  resolve: sharedResolve,
  server: {
    port: 5174,
    strictPort: true,
    host: "127.0.0.1",
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd()), sharedDir]
    }
  },
  preview: {
    port: 4174,
    strictPort: true,
    host: "127.0.0.1"
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          bootstrap: ["bootstrap", "react-bootstrap"],
          icons: ["react-icons"]
        }
      }
    }
  }
});
