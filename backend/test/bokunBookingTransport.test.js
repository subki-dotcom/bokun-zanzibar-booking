process.env.NODE_ENV = "test";
process.env.MONGO_URI = "mongodb://127.0.0.1:1/unused-transport-test";
process.env.JWT_SECRET = "transport-fixture-secret";
process.env.BOKUN_MOCK_MODE = "false";
process.env.BOKUN_ACCESS_KEY = "fixture-access";
process.env.BOKUN_SECRET_KEY = "fixture-secret";
process.env.BOKUN_BASE_URL = "https://supplier.example.test";
process.env.BOKUN_RETRY_COUNT = "2";

const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
let calls = [];
// Replaces the transport before the integration client is constructed. No socket
// or real supplier request is used, even with live-mode request construction.
axios.defaults.adapter = async (config) => {
  calls.push(config);
  throw Object.assign(new Error("Fixture network connection reset"), { code: "ECONNRESET", config });
};
const client = require("../src/integrations/bokun/bokun.client");

for (const path of ["/checkout.json/submit", "/checkout.json/confirm-reserved/FIXTURE-123"]) {
  test("transport never automatically replays booking write " + path, async () => {
    calls = [];
    await assert.rejects(client.request({ method: "post", path, payload: {}, retry: false }), { code: "BOKUN_UPSTREAM_UNREACHABLE" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]["axios-retry"].retries, 0);
  });
}
