import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

test("failed dashboard requests show an error instead of empty financial data", async () => {
  const server = await createServer({ configFile: false, esbuild: { jsx: "automatic" }, server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true }, appType: "custom" });
  try {
    const { BookingAccountingDashboard } = await server.ssrLoadModule("/src/pages/admin/AdminBookingAccountingPage.jsx");
    const render = (props) => renderToStaticMarkup(React.createElement(MemoryRouter, null,
      React.createElement(BookingAccountingDashboard, {
        filters: { dateRange: "last_month", channel: "" }, setFilters() {}, onRefresh() {},
        loading: false, summaryLoading: false, ...props
      })));
    const failed = render({ error: "Dashboard timed out", summaryError: "Financial facts timed out" });
    assert.match(failed, /Dashboard timed out/);
    assert.match(failed, /Financial facts timed out/);
    assert.doesNotMatch(failed, /No authoritative financial facts|No revenue or cost data|No booking financials|Total Bookings/);
    const partial = render({ error: "", summaryError: "Financial facts timed out", dashboard: { summaryKpis: { bookingRevenue: { label: "Booking Revenue", value: 250, type: "money" } } } });
    assert.match(partial, /Booking Revenue/);
    assert.match(partial, /250/);
    assert.match(partial, /Financial facts timed out/);
  } finally { await server.close(); }
});
