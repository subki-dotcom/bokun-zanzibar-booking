// One colour map for every status badge in the admin. Failed (red) and cancelled (grey) are never the same colour.
const TONES = {
  success: ["paid", "confirmed", "completed", "complete", "active", "approved", "available", "configured", "covered", "observed",
    "resolved", "reconciled", "matched", "ready", "live", "running", "healthy", "pass", "posted", "settled", "success", "succeeded",
    "verified", "won", "connected", "received", "imported", "on"],
  warning: ["pending", "open", "processing", "partially_paid", "partial", "review_required", "needs_review", "warning", "warn",
    "limited", "degraded", "mock", "test", "awaiting", "awaiting_settlement_data", "unpaid", "due", "overdue", "draft", "in_progress",
    "retry", "pending_retry", "supplier_pending", "delayed", "planned", "unknown_pending", "awaiting_evidence"],
  danger: ["failed", "fail", "error", "critical", "high", "blocked", "rejected", "not_configured", "mismatch", "missing", "lost",
    "payment_failed", "supplier_failed", "declined", "expired", "unhealthy"],
  neutral: ["cancelled", "canceled", "void", "voided", "disabled", "stopped", "closed", "archived", "inactive", "skipped", "off",
    "refunded", "unknown", "none", "n/a"],
  info: ["submitted", "info", "acknowledged", "new", "scheduled", "queued", "sent", "started", "upcoming", "low", "medium"]
};

const LOOKUP = Object.fromEntries(Object.entries(TONES).flatMap(([tone, values]) => values.map((value) => [value, tone])));

export const statusTone = (value = "") => {
  const key = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!key) return "neutral";
  if (LOOKUP[key]) return LOOKUP[key];
  if (/fail|error|critical|reject|mismatch/.test(key)) return "danger";
  if (/cancel|void|disabled|inactive/.test(key)) return "neutral";
  if (/pending|await|review|partial|due|retry|warn/.test(key)) return "warning";
  if (/paid|confirm|complete|success|match|reconcil|posted|active/.test(key)) return "success";
  return "info";
};

export const TONE_NAMES = Object.keys(TONES);
