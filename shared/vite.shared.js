import { fileURLToPath } from "node:url";

// shared/ has no node_modules, so every package its code imports must be resolved from the app that
// builds it. Listing them in resolve.dedupe does that and keeps one React, router and auth context.
export const SHARED_PACKAGES = ["react", "react-dom", "react-router-dom", "react-bootstrap", "axios", "dayjs"];

export const sharedDir = fileURLToPath(new URL(".", import.meta.url));

export const sharedResolve = { dedupe: SHARED_PACKAGES };
