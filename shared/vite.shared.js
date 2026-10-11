import { fileURLToPath } from "node:url";

// Code outside an app's own folder (shared/, and backoffice/ when the website mounts its /admin fallback)
// must resolve its packages from the app that builds it. Listing them in resolve.dedupe does that and keeps
// one React, router and auth context per app.
export const SHARED_PACKAGES = ["react", "react-dom", "react-router-dom", "react-bootstrap", "react-icons", "bootstrap", "axios", "dayjs"];

export const sharedDir = fileURLToPath(new URL(".", import.meta.url));

export const sharedResolve = { dedupe: SHARED_PACKAGES };
