// Local end-to-end workflow run. Isolated DB, mocked Bokun/Pesapal, email disabled, outbound HTTP blocked.
// Usage (from backend/): npm run test:e2e-local   — needs a local MongoDB on 127.0.0.1:27017.
// Drops and recreates the bokun_e2e_local database only.
//        npm run test:e2e-local:isolated — starts its own throwaway mongod (MONGOD_BINARY or the default
//        install path) in a temporary directory and deletes it afterwards; no existing database is used.
const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const cliArgs = process.argv.slice(2);
const ISOLATED_MONGO = cliArgs.includes("--isolated-mongo");
const backendDir = path.resolve(cliArgs.find((arg) => !arg.startsWith("--")) || path.join(__dirname, "..", ".."));
const PORT = 5055;
const BASE = `http://127.0.0.1:${PORT}/api`;
const ADMIN = { email: "e2e-admin@example.test", password: "E2e-Local-Passw0rd!" };

const ENV = {
  NODE_ENV: "development",
  PORT: String(PORT),
  MONGO_URI: "mongodb://127.0.0.1:27017/bokun_e2e_local",
  JWT_SECRET: "e2e-local-only-jwt-signing-value-0123456789abcdef",
  FRONTEND_URL: "http://localhost:5173",
  PASSWORD_RESET_SITE_URL: "http://localhost:5173",
  DEFAULT_CURRENCY: "USD",
  BOKUN_MOCK_MODE: "true",
  BOKUN_ACCESS_KEY: "mock-access",
  BOKUN_SECRET_KEY: "mock-secret",
  BOKUN_API_KEY: "mock-api-key",
  BOKUN_BASE_URL: "http://127.0.0.1:9",
  PESAPAL_MOCK_MODE: "true",
  PESAPAL_MOCK_CONFIRMS_PAYMENT: "true",
  PESAPAL_CONSUMER_KEY: "mock-key",
  PESAPAL_CONSUMER_SECRET: "mock-secret",
  PESAPAL_IPN_ID: "mock-ipn",
  PESAPAL_BASE_URL: "http://127.0.0.1:9",
  PESAPAL_ALLOW_LOCAL_REDIRECTS: "true",
  PESAPAL_SUCCESS_URL: "http://localhost:5173/payment-success",
  PESAPAL_CANCEL_URL: "http://localhost:5173/payment-failure",
  PAYPAL_MOCK_MODE: "false",
  DPO_MOCK_MODE: "false",
  EMAIL_ENABLED: "false",
  RESEND_API_KEY: "",
  GOOGLE_PLACES_API_KEY: "",
  RATE_LIMIT_MAX: "100000"
};

const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const call = async (method, url, { body, token, headers = {}, expect } = {}) => {
  const started = performance.now();
  const response = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const ms = Math.round(performance.now() - started);
  let json = null;
  try {
    json = await response.json();
  } catch (_error) {
    json = null;
  }
  return { status: response.status, json, ms, ok: expect ? response.status === expect : response.ok };
};

const seedAdmin = async () => {
  Object.assign(process.env, ENV);
  const mongoose = require(path.join(backendDir, "node_modules/mongoose"));
  await mongoose.connect(ENV.MONGO_URI);
  await mongoose.connection.db.dropDatabase();
  const authService = require(path.join(backendDir, "src/services/auth"));
  await authService.registerAdmin({ firstName: "Local", lastName: "Admin", ...ADMIN, role: "super_admin" }, null);
  await mongoose.disconnect();
};

const startServer = () =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-r", path.join(__dirname, "blocknet.js"), path.join(backendDir, "server.js")], {
      cwd: __dirname,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...ENV },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const logs = [];
    const onData = (chunk) => {
      const text = chunk.toString();
      logs.push(text);
      if (text.includes("E2E_BLOCKED_OUTBOUND")) console.log(`!! ${text.trim()}`);
      if (text.includes("Server started")) resolve({ child, logs });
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`server exited ${code}: ${logs.join("").slice(-2000)}`)));
  });

module.exports = { call, record, results, ADMIN, BASE };

const MONGOD_BINARY = process.env.MONGOD_BINARY || (process.platform === "win32" ? "C:/Program Files/MongoDB/Server/8.2/bin/mongod.exe" : "/usr/bin/mongod");

// A throwaway mongod on a free port in a fresh temporary directory.
const startIsolatedMongo = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "riser-e2e-mongo-"));
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(MONGOD_BINARY, ["--bind_ip", "127.0.0.1", "--port", String(port), "--dbpath", directory, "--quiet"], { windowsHide: true, stdio: "ignore" });
  ENV.MONGO_URI = `mongodb://127.0.0.1:${port}/bokun_e2e_local`;
  const stop = async () => {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    // Delete only the unique temporary directory created above.
    const resolved = fs.realpathSync(directory);
    if (path.dirname(resolved) === fs.realpathSync(os.tmpdir()) && path.basename(resolved).startsWith("riser-e2e-mongo-")) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  };
  return { stop };
};

const main = async () => {
  const isolated = ISOLATED_MONGO ? await startIsolatedMongo() : null;
  try {
    await runHarness();
  } finally {
    await isolated?.stop();
  }
};

const runHarness = async () => {
  await seedAdmin();
  const { child, logs } = await startServer();
  const ctx = { mongoUri: ENV.MONGO_URI };
  try {
    const steps = require(path.join(__dirname, "steps.js"));
    await steps({ call, record, ADMIN, ctx, backendDir });
    if (ctx.readiness) {
      console.log(`
Local production readiness: ${ctx.readiness.status}`);
      ctx.readiness.checks.forEach((check) => console.log(`  ${check.status.toUpperCase().padEnd(4)} ${check.id}: ${check.message}`));
    }
  } catch (error) {
    record("harness", false, error.stack.split("\n").slice(0, 3).join(" | "));
  } finally {
    child.kill();
  }
  const blocked = logs.join("").match(/E2E_BLOCKED_OUTBOUND [^\n]+/g) || [];
  record("no outbound network attempts", blocked.length === 0, blocked.slice(0, 3).join("; "));
  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
