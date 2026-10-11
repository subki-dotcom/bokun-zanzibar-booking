const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAllowedOrigins, isOriginAllowed, PRODUCTION_FRONTEND_ORIGINS } = require("../src/config/corsOrigins");

test("the local Back Office origin comes from BACKOFFICE_URL", () => {
  const allowedOrigins = buildAllowedOrigins({
    frontendUrl: "http://localhost:5173",
    backofficeUrl: "http://localhost:5174/, http://127.0.0.1:5174",
    nodeEnv: "development"
  });
  assert.ok(allowedOrigins.includes("http://localhost:5174"));
  assert.ok(allowedOrigins.includes("http://127.0.0.1:5174"));
  assert.ok(isOriginAllowed({ origin: "http://localhost:5174", allowedOrigins, nodeEnv: "development" }));
});

test("production ignores non-https Back Office origins and keeps rejecting localhost", () => {
  const allowedOrigins = buildAllowedOrigins({
    frontendUrl: "https://zanzibartoursandsafaris.co.tz",
    backofficeUrl: "http://localhost:5174,https://admin.example.test",
    nodeEnv: "production"
  });
  assert.equal(allowedOrigins.includes("http://localhost:5174"), false);
  assert.ok(allowedOrigins.includes("https://admin.example.test"));
  assert.equal(isOriginAllowed({ origin: "http://localhost:5174", allowedOrigins, nodeEnv: "production" }), false);
  assert.equal(isOriginAllowed({ origin: "https://evil.example.test", allowedOrigins, nodeEnv: "production" }), false);
});

test("without BACKOFFICE_URL the allow-list is unchanged", () => {
  const allowedOrigins = buildAllowedOrigins({ frontendUrl: "https://zanzibartoursandsafaris.co.tz", nodeEnv: "production" });
  assert.deepEqual(allowedOrigins, [...new Set(["https://zanzibartoursandsafaris.co.tz", ...PRODUCTION_FRONTEND_ORIGINS])]);
});

test("development still accepts any localhost port, as before", () => {
  assert.ok(isOriginAllowed({ origin: "http://127.0.0.1:5183", allowedOrigins: [], nodeEnv: "development" }));
});
