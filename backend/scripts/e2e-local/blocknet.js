// Preloaded into the local E2E server: refuses any outbound HTTP(S) that is not to localhost.
const http = require("node:http");
const https = require("node:https");

const isLocal = (host = "") => /^(localhost|127\.0\.0\.1|::1|\[::1\])$/i.test(String(host).split(":")[0]);
const hostOf = (args) => {
  const [first, second] = args;
  if (typeof first === "string" || first instanceof URL) return new URL(String(first)).hostname;
  return (first && (first.hostname || first.host)) || (second && (second.hostname || second.host)) || "";
};

for (const mod of [http, https]) {
  for (const name of ["request", "get"]) {
    const original = mod[name];
    mod[name] = function blocked(...args) {
      const host = hostOf(args);
      if (!isLocal(host)) {
        console.error(`E2E_BLOCKED_OUTBOUND ${host}`);
        throw new Error(`Outbound request to ${host} blocked in local E2E`);
      }
      return original.apply(this, args);
    };
  }
}

if (typeof globalThis.fetch === "function") {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const host = new URL(typeof input === "string" ? input : input.url).hostname;
    if (!isLocal(host)) {
      console.error(`E2E_BLOCKED_OUTBOUND ${host}`);
      return Promise.reject(new Error(`Outbound fetch to ${host} blocked in local E2E`));
    }
    return originalFetch(input, init);
  };
}
