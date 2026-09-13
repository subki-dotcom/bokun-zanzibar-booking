# Report Center implementation — 9 September 2026

Implemented in the existing `/admin/report-center` route. The application shell, navy sidebar, authentication, report permissions, accounting calculations and Bókun integration remain in place.

## Files changed

Frontend:
- `frontend/src/pages/admin/AdminReportCenterPage.jsx`
- `frontend/src/pages/admin/reportCenter.css` (new)
- `frontend/src/components/admin/reportCenter/ReportCenterComponents.jsx` (new)
- `frontend/src/components/admin/reportCenter/reportCenterView.js` (new)
- `frontend/src/components/admin/reportCenter/useReportResource.js` (new)
- `frontend/src/api/adminApi.js`
- `frontend/test/reportCenter.test.js` (new)
- `frontend/test/reportCenterRendering.test.js` (new)

Backend:
- `backend/src/reportCenter/summaryService.js` (new)
- `backend/src/reportCenter/exportService.js`
- `backend/src/reportCenter/reportQueryService.js`
- `backend/src/reportCenter/reportRegistry.js`
- `backend/src/controllers/reportCenter.controller.js`
- `backend/src/routes/reportCenter.routes.js`
- `backend/src/validators/reportCenter.validation.js`
- `backend/test/reportCenterSummary.test.js` (new)
- `backend/test/reportCenterCore.test.js`
- `backend/test/reportCenterRoutes.test.js`

Earlier Business Intelligence changes in the working tree were preserved and are documented separately.

## Components and behavior

Added ReportKpiGrid, ReportNavigator, ReportPreview, ExportHistory, ReportSkeleton, ReportEmpty and ReportError. Reused existing StatusBadge, icon library, authentication hook, API client and number/date/currency helpers. Each API resource has independent loading/error/retry state and cancellation of obsolete requests.

Search is debounced. Report configuration uses catalog-supported formats and grouping. Custom dates are validated. A synchronous generation lock prevents duplicate clicks; actual downloadable responses trigger downloads and refresh history and summary counts. History pagination is server-side. Regeneration preserves recorded original ISO dates; older entries without recoverable dates cannot silently regenerate a different period.

## APIs and authoritative data

Reused catalog, report preview, export and export-history endpoints under `/api/admin/report-center`. Added read-protected `GET /summary`. History gains additive pagination, report titles, original periods and batched generator-name resolution. Catalog definitions expose actual report sections.

- Total Reports Generated: completed ReportExport records in the selected period; previews are not tracked as exports.
- Exports This Month: completed ReportExport records in the current calendar month, with previous calendar-month comparison.
- Active Users: currently enabled User accounts, explicitly distinguished from online users or period activity.
- Scheduled Reports: unavailable; no scheduling backend exists.
- Preview financial values: existing canonical report service outputs, including management financial KPIs, booking costs and backend-computed gross/net profit and margins. No frontend financial formulas were introduced.

Existing financial and operational date dimensions and source-link accounting strategy remain authoritative. Changing dates re-fetches the selected report and period-based export count. Month-specific exports and current enabled accounts retain their clearly stated bases.

## Responsive behavior

Desktop uses four KPIs and approximately 24/76 report navigation/workspace columns. Tablet uses two KPI columns and a collapsible report selector at 1024px. Mobile stacks configuration controls, uses full-width actions, one-column report sections and export-history cards; detailed financial tables scroll within their own container. At 360px KPIs use one column. Controls have practical 44px targets, keyboard focus styles and labelled states.

## Supported limits

- Scheduling remains disabled, with an explanation. No fake schedules or trends.
- Exports are streamed, not retained. History offers supported regeneration, not fictitious archived downloads/deletes.
- Legacy canonical report totals do not certify one common currency. The preview discloses this and does not assign USD/TZS to uncertified totals. Explicit row currencies use the shared currency formatter; no exchange-rate conversion or accounting-rule change was introduced.
- Only the existing 38 catalog reports and actual included sections are exposed.

## Verification

- Frontend suite: 91 passed, 0 failed.
- Backend suite: 373 passed, 0 failed, 1 skipped (opt-in BI Mongo integration).
- New tests cover monetary formatting, unavailable values, authoritative preview metrics, original-date regeneration, invalid dates, report metadata, loading/error rendering and permission-aware history actions. Existing tests cover real CSV, Excel XML, PDF and print renderers and export route streaming.
- Final production build passed. Existing bundle-size warning remains.
- `git diff --check`: no whitespace errors.
- Backend lint could not run because the installed dependencies lack the ESLint executable. Neither package defines a typecheck script; frontend has no lint script.
- Local authenticated API smoke checks passed: 38-report catalog, current/previous-month summaries, custom August report preview with correct Dar es Salaam bounds and four real sections, paginated history. The Report Center frontend returned HTTP 200. No synthetic business records or test exports were inserted in the local database.
- Backend restarted on port 5000; frontend remains available on port 5173.
- Browser runtime reported no connected browser. Visual viewport checks and browser-console verification remain pending; responsive CSS and server-rendered states were checked, but are not a substitute for browser verification.
