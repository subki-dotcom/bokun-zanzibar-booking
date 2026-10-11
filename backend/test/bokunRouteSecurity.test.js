process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/bokun-route-security-test";
process.env.JWT_SECRET ||= "bokun-route-security-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");

const app = require("../src/app");
const User = require("../src/models/User");
const bokunService = require("../src/services/bokun");

const userId = "66ffffffffffffffffffffff";
const token = () => jwt.sign({ sub: userId, userType: "user" }, process.env.JWT_SECRET, { expiresIn: "5m" });

const withMockUser = (role) => {
  const original = User.findById;
  User.findById = () => ({
    lean: async () => ({ _id: { toString: () => userId }, firstName: "Test", lastName: "User", fullName: "Test User", role, isActive: true, email: `${role}@example.test` })
  });
  return () => { User.findById = original; };
};

// Records supplier calls instead of reaching Bokun.
const withSupplierSpy = () => {
  const calls = [];
  const originals = {};
  for (const name of ["createBooking", "lookupBooking", "cancelBooking", "editBooking"]) {
    originals[name] = bokunService[name];
    bokunService[name] = async () => { calls.push(name); return { ok: true }; };
  }
  return { calls, restore: () => Object.assign(bokunService, originals) };
};

const listen = async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
};
const close = (server) => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

const endpoints = [
  ["POST", "/api/bokun/bookings", { productId: "1" }],
  ["GET", "/api/bokun/bookings/ABC-123"],
  ["POST", "/api/bokun/bookings/123/cancel", {}],
  ["POST", "/api/bokun/bookings/123/edit", {}]
];

const send = (port, [method, path, body], headers = {}) =>
  fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined
  });

test("direct Bokun booking writes and lookups reject anonymous callers without reaching the supplier", async () => {
  const spy = withSupplierSpy();
  const server = await listen();
  try {
    const { port } = server.address();
    for (const endpoint of endpoints) {
      const response = await send(port, endpoint);
      assert.equal(response.status, 401, `${endpoint[0]} ${endpoint[1]}`);
    }
    assert.deepEqual(spy.calls, []);
  } finally {
    spy.restore();
    await close(server);
  }
});

test("staff and agents cannot create, cancel, edit or look up Bokun bookings directly", async () => {
  for (const role of ["staff", "agent"]) {
    const restoreUser = withMockUser(role);
    const spy = withSupplierSpy();
    const server = await listen();
    try {
      const { port } = server.address();
      for (const endpoint of endpoints) {
        const response = await send(port, endpoint, { Authorization: `Bearer ${token()}` });
        assert.equal(response.status, 403, `${role} ${endpoint[0]} ${endpoint[1]}`);
      }
      assert.deepEqual(spy.calls, [], role);
    } finally {
      spy.restore();
      restoreUser();
      await close(server);
    }
  }
});

test("administrators keep access to the direct Bokun booking endpoints", async () => {
  const restoreUser = withMockUser("admin");
  const spy = withSupplierSpy();
  const server = await listen();
  try {
    const { port } = server.address();
    for (const endpoint of endpoints) {
      const response = await send(port, endpoint, { Authorization: `Bearer ${token()}` });
      assert.ok(response.status < 400, `${endpoint[0]} ${endpoint[1]} -> ${response.status}`);
    }
    assert.deepEqual(spy.calls, ["createBooking", "lookupBooking", "cancelBooking", "editBooking"]);
  } finally {
    spy.restore();
    restoreUser();
    await close(server);
  }
});

test("public read-only Bokun endpoints used by the website stay open", async () => {
  const original = bokunService.fetchCountries;
  bokunService.fetchCountries = async () => [{ code: "TZ", name: "Tanzania" }];
  const server = await listen();
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/bokun/countries`);
    assert.equal(response.status, 200);
  } finally {
    bokunService.fetchCountries = original;
    await close(server);
  }
});
