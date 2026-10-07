import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

test("dashboard retains its original graphs and reports request errors separately", async () => {
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
    assert.doesNotMatch(failed, /No authoritative financial facts/);
    for (const title of ["Revenue vs Direct Costs", "Revenue by Channel", "Profitability Overview", "Recent Booking Financials", "Top Profitable Products"]) {
      assert.ok(failed.includes(title));
    }
    const partial = render({ error: "", summaryError: "Financial facts timed out", dashboard: { summaryKpis: { bookingRevenue: { label: "Booking Revenue", value: 250, type: "money" } } } });
    assert.match(partial, /Booking Revenue/);
    assert.match(partial, /250/);
    assert.match(partial, /Financial facts timed out/);
    const retained = render({ error: "Refresh timed out", dashboard: { charts: {
      revenueVsCosts: [{ key: "sept", label: "Sep", revenue: 250, directCosts: 50 }],
      revenueByChannel: [{ value: "DIRECT", label: "Direct", revenue: 250, percent: 100 }],
      profitabilityOverview: [{ key: "sept", label: "Sep", revenue: 250, directCosts: 50, margin: 80 }]
    } } });
    assert.match(retained, /aria-label="Revenue versus direct costs"/);
    assert.match(retained, /booking-accounting-dashboard-donut/);
    assert.match(retained, /aria-label="Profitability overview"/);
    assert.match(retained, /Refresh timed out/);
  } finally { await server.close(); }
});
