import { fileURLToPath } from "node:url";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
import { sharedDir, sharedResolve } from "../shared/vite.shared.js";

// The /admin fallback mounts the Back Office route table from ../backoffice.
const backofficeSrcDir = fileURLToPath(new URL("../backoffice/src", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: sharedResolve,
  server: {
    port: 5173,
    host: "127.0.0.1",
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd()), sharedDir, backofficeSrcDir]
    }
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
