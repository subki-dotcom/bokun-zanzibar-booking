const logger = require("../config/logger");

// Process-wide measurements: overlapping jobs share the same heap/RSS.
// Never accept booking data, request payloads, or customer identifiers here.
const active = new Map();
let timer = null;
let sequence = 0;

const sample = (phase, runId, job, startedAt) => {
  try {
    const memory = process.memoryUsage();
    logger.info("Bokun job memory diagnostics", {
      phase,
      runId,
      job,
      elapsedMs: startedAt === undefined ? undefined : Date.now() - startedAt,
      activeJobs: [...active.values()],
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      arrayBuffersBytes: memory.arrayBuffers
    });
  } catch {
    // Diagnostic failures must not interrupt synchronization or retries.
  }
};

const startJobMemoryDiagnostics = (job) => {
  const runId = ++sequence;
  const startedAt = Date.now();
  active.set(runId, job);
  sample("start", runId, job, startedAt);
  if (!timer) {
    timer = setInterval(() => sample("sample"), 60 * 1000);
    timer.unref();
  }
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    sample("end", runId, job, startedAt);
    active.delete(runId);
    if (!active.size) {
      clearInterval(timer);
      timer = null;
    }
  };
};

module.exports = { startJobMemoryDiagnostics };
