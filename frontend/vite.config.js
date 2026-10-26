import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "127.0.0.1",
    // "My booking" calls /api on the site address (first-party cookie); locally that is the backend on :5000.
    proxy: {
      "/api": { target: process.env.VITE_DEV_API_PROXY || "http://127.0.0.1:5000" }
    }
  },
  preview: {
    proxy: {
      "/api": { target: process.env.VITE_DEV_API_PROXY || "http://127.0.0.1:5000" }
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
