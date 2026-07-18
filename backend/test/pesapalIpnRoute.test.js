const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/pesapal-ipn-route-test";
process.env.JWT_SECRET ||= "pesapal-ipn-route-test-secret";
process.env.PESAPAL_MOCK_MODE = "true";

const app = require("../src/app");

test("does not reject the Pesapal IPN route because of public-site CORS", async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const { port } = server.address();
    const response = await fetch(
      `http://127.0.0.1:${port}/api/payments/pesapal/ipn`,
      {
        method: "OPTIONS",
        headers: { Origin: "https://pay.pesapal.com" }
      }
    );
    assert.equal(response.status, 200);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
