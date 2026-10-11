# shared

Code used by both the public website (`frontend/`) and the Back Office.

| Module | Purpose |
| --- | --- |
| `src/config/api.js` | API base URL (`VITE_API_BASE_URL`) |
| `src/api/axiosClient.js` | HTTP client: bearer token, timeouts, error normalisation |
| `src/api/authApi.js` | Login, current profile, password recovery |
| `src/api/bookingsApi.js`, `bookingRequestsApi.js`, `invoicesApi.js` | Booking, booking request and invoice endpoints used by both apps |
| `src/context/AuthContext.jsx`, `src/hooks/useAuth.js` | Session state and the `useAuth` hook |
| `src/components/common/` | `Loader`, `ErrorAlert`, `ProtectedRoute`, `ListingPagination` |
| `src/utils/` | `formatters`, `cancellationPolicy`, `pagination` |

Rules:

- Nothing here imports from `frontend/` or the Back Office. Shared code only depends on other shared code and on the packages listed in `package.json`.
- There is no `node_modules` here. Each app resolves the packages from its own install. The app's `vite.config.js` lists them in `resolve.dedupe` and allows `../shared` in `server.fs.allow`.
- The old paths in `frontend/src` still exist as re-exports, so existing imports keep working. New code should import from here.
- Each app is built separately, so the auth session is stored per origin. The website (5173) and the Back Office (5174) each need their own login.
