import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const authApiSource = fs.readFileSync(path.join(process.cwd(), "src", "api", "authApi.js"), "utf8");
const loginPageSource = fs.readFileSync(
  path.join(process.cwd(), "src", "pages", "public", "LoginPage.jsx"),
  "utf8"
);

test("auth requests tolerate slow production backend cold starts", () => {
  assert.ok(authApiSource.includes("AUTH_REQUEST_TIMEOUT_MS = 120000"));
  assert.ok(authApiSource.includes('axiosClient.post("/auth/login", payload, { timeout: AUTH_REQUEST_TIMEOUT_MS })'));
  assert.ok(authApiSource.includes('axiosClient.get("/auth/me", { timeout: AUTH_REQUEST_TIMEOUT_MS })'));
});

test("login page warms the API and explains slow startup while signing in", () => {
  assert.ok(loginPageSource.includes("warmAuthBackend"));
  assert.ok(loginPageSource.includes("useEffect(() =>"));
  assert.ok(loginPageSource.includes("Waking secure server..."));
  assert.ok(loginPageSource.includes("The secure API is starting up. Please keep this page open."));
});
