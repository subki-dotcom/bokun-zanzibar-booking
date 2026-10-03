const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const load = () => {
  const logs = [];
  const timers = new Set();
  let failLogging = false;
  const context = {
    module: { exports: {} },
    require: () => ({ info: (message, meta) => {
      if (failLogging) throw new Error("logger unavailable");
      logs.push(JSON.parse(JSON.stringify({ message, ...meta })));
    } }),
    process: { memoryUsage: () => ({ rss: 100, heapUsed: 50, heapTotal: 80, external: 20, arrayBuffers: 10, secret: "must not log" }) },
    setInterval: (callback, delay) => {
      assert.equal(delay, 60000);
      const timer = { callback, unref() { this.unreferenced = true; } };
      timers.add(timer);
      return timer;
    },
    clearInterval: timer => timers.delete(timer)
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/utils/jobMemoryDiagnostics.js"), "utf8"), context);
  return { start: context.module.exports.startJobMemoryDiagnostics, logs, timers, fail: () => { failLogging = true; } };
};

test("overlapping jobs share one unreferenced sampler and release it on completion", () => {
  const { start, logs, timers } = load();
  const finishSync = start("booking_sync");
  const finishImport = start("confirmed_booking_import");
  assert.equal(timers.size, 1);
  const timer = [...timers][0];
  assert.equal(timer.unreferenced, true);
  timer.callback();
  assert.deepEqual(logs.at(-1).activeJobs, ["booking_sync", "confirmed_booking_import"]);
  assert.equal(logs.at(-1).rssBytes, 100);
  assert.equal(JSON.stringify(logs).includes("must not log"), false);
  finishSync();
  finishSync();
  assert.equal(timers.size, 1);
  timer.callback();
  assert.deepEqual(logs.at(-1).activeJobs, ["confirmed_booking_import"]);
  finishImport();
  assert.equal(timers.size, 0);
  assert.equal(logs.filter(log => log.phase === "end").length, 2);
  start("booking_sync")();
  assert.equal(timers.size, 0);
});

test("logging failure does not escape diagnostics or prevent timer cleanup", () => {
  const { start, timers, fail } = load();
  fail();
  const finish = start("booking_sync");
  assert.doesNotThrow(() => [...timers][0].callback());
  assert.doesNotThrow(finish);
  assert.equal(timers.size, 0);
});
