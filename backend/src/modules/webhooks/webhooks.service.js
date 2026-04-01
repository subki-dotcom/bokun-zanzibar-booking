const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const Booking = require("../../models/Booking");
const SyncLog = require("../../models/SyncLog");
const AuditLog = require("../../models/AuditLog");
const ProductSnapshot = require("../../models/ProductSnapshot");
const AppError = require("../../utils/AppError");
const logger = require("../../config/logger");
const { env } = require("../../config/env");
const { BOOKING_STATUS } = require("../../config/constants");
const bokunService = require("../../integrations/bokun");
const invoicesService = require("../invoices/invoices.service");

const INTERNAL_REQUEST_PREFIX = "bokun_sync";
const ACTIVE_BOOKING_STATUSES = [
  BOOKING_STATUS.PENDING,
  BOOKING_STATUS.CONFIRMED,
  BOOKING_STATUS.EDIT_REQUESTED,
  BOOKING_STATUS.CANCELLED
];

let bookingSyncRunning = false;

const buildInternalRequestId = () => `${INTERNAL_REQUEST_PREFIX}_${uuidv4()}`;

const toNonEmptyString = (value = "") => {
  const token = String(value || "").trim();
  return token || "";
};

const normalizeWebhookEvents = (payload) => {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && Array.isArray(payload.events)) {
    return payload.events;
  }

  if (payload && typeof payload === "object") {
    return [payload];
  }

  return [];
};

const extractContextFromEvent = (event = {}) => {
  const candidateRoots = [
    event,
    event?.data || null,
    event?.booking || null,
    event?.reservation || null,
    event?.payload || null,
    event?.object || null
  ].filter(Boolean);

  const pickFirst = (keys = []) => {
    for (const root of candidateRoots) {
      for (const key of keys) {
        const value = root?.[key];
        const token = toNonEmptyString(value);
        if (token) {
          return token;
        }
      }
    }

    return "";
  };

  return {
    eventType: pickFirst(["eventType", "event", "type", "action"]) || "unknown",
    statusHint: pickFirst(["status", "bookingStatus", "state"]),
    bookingReference: pickFirst(["bookingReference", "reference", "bookingCode"]),
    bokunBookingId: pickFirst(["bokunBookingId", "bookingId", "id"]),
    bokunConfirmationCode: pickFirst(["confirmationCode", "bokunConfirmationCode", "code"])
  };
};

const mapBokunStatusToLocal = (statusValue = "") => {
  const status = String(statusValue || "").trim().toUpperCase();
  if (!status) {
    return BOOKING_STATUS.PENDING;
  }

  if (
    status.includes("CANCEL") ||
    status.includes("VOID")
  ) {
    return BOOKING_STATUS.CANCELLED;
  }

  if (
    status.includes("EDIT") ||
    status.includes("CHANGE") ||
    status.includes("AMEND") ||
    status.includes("RESCHEDULE")
  ) {
    return BOOKING_STATUS.EDIT_REQUESTED;
  }

  if (
    status.includes("FAILED") ||
    status.includes("DECLINED") ||
    status.includes("REJECTED") ||
    status.includes("ERROR")
  ) {
    return BOOKING_STATUS.FAILED;
  }

  if (
    status.includes("CONFIRMED") ||
    status.includes("BOOKED") ||
    status.includes("COMPLETE") ||
    status.includes("SUCCESS")
  ) {
    return BOOKING_STATUS.CONFIRMED;
  }

  return BOOKING_STATUS.PENDING;
};

const resolveLookupKeys = ({
  booking = null,
  bookingReference = "",
  bokunBookingId = "",
  bokunConfirmationCode = ""
} = {}) => {
  return Array.from(
    new Set(
      [
        bookingReference,
        bokunBookingId,
        bokunConfirmationCode,
        booking?.bookingReference || "",
        booking?.bokunBookingId || "",
        booking?.bokunConfirmationCode || ""
      ]
        .map((item) => toNonEmptyString(item))
        .filter(Boolean)
    )
  );
};

const lookupBokunBookingWithFallback = async ({ lookupKeys = [], requestId = "" }) => {
  let lastError = null;

  for (const key of lookupKeys) {
    try {
      const result = await bokunService.lookupBooking(key, requestId);
      if (result && (result.bookingReference || result.bokunBookingId || result.status)) {
        return result;
      }
    } catch (error) {
      lastError = error;
      if (Number(error.statusCode || 0) === 404) {
        continue;
      }
    }
  }

  if (lastError && Number(lastError.statusCode || 0) !== 404) {
    throw lastError;
  }

  return null;
};

const updateInvoiceSnapshot = async (bookingDoc) => {
  const productSnapshot = await ProductSnapshot.findOne({
    bokunProductId: bookingDoc.bokunProductId
  }).lean();

  const invoiceSnapshot = await invoicesService.buildInvoiceSnapshot({
    booking: bookingDoc.toObject(),
    productSnapshot
  });
  bookingDoc.invoiceSnapshot = invoiceSnapshot;
  await bookingDoc.save();
  await invoicesService.upsertInvoiceFromSnapshot(invoiceSnapshot);
};

const setSyncState = (bookingDoc, { source, status, error = "" }) => {
  bookingDoc.syncState = {
    ...(bookingDoc.syncState || {}),
    lastBokunSyncAt: new Date(),
    lastBokunSyncSource: source,
    lastBokunStatus: toNonEmptyString(status || bookingDoc.syncState?.lastBokunStatus || ""),
    lastBokunSyncError: toNonEmptyString(error)
  };
};

const applyBokunSnapshotToBooking = async ({
  bookingDoc,
  bokunBooking = null,
  statusHint = "",
  source = "system",
  requestId = "",
  reason = ""
}) => {
  const before = {
    bookingStatus: bookingDoc.bookingStatus,
    travelDate: bookingDoc.travelDate,
    startTime: bookingDoc.startTime,
    bokunBookingId: bookingDoc.bokunBookingId,
    bokunConfirmationCode: bookingDoc.bokunConfirmationCode
  };

  const resolvedStatus = bokunBooking?.status || statusHint || "";
  const mappedStatus = mapBokunStatusToLocal(resolvedStatus);
  let businessChanged = false;

  const assignIfChanged = (key, value) => {
    const nextValue = toNonEmptyString(value);
    if (!nextValue || bookingDoc[key] === nextValue) {
      return;
    }
    bookingDoc[key] = nextValue;
    businessChanged = true;
  };

  assignIfChanged("bokunBookingId", bokunBooking?.bokunBookingId || "");
  if (!toNonEmptyString(bookingDoc.bookingReference)) {
    assignIfChanged("bookingReference", bokunBooking?.bookingReference || "");
  }
  assignIfChanged("bokunConfirmationCode", bokunBooking?.confirmationCode || "");
  assignIfChanged("travelDate", bokunBooking?.travelDate || "");
  assignIfChanged("startTime", bokunBooking?.startTime || "");

  if (mappedStatus && bookingDoc.bookingStatus !== mappedStatus) {
    bookingDoc.bookingStatus = mappedStatus;
    if (mappedStatus === BOOKING_STATUS.CANCELLED && !bookingDoc.cancellation?.cancelledAt) {
      bookingDoc.cancellation = {
        reason: reason || "Updated from Bokun status sync",
        cancelledAt: new Date(),
        cancelledBy: "bokun_sync"
      };
    }
    businessChanged = true;
  }

  if (bokunBooking?.raw) {
    const previousRaw = JSON.stringify(bookingDoc.rawBokunResponse || null);
    const nextRaw = JSON.stringify(bokunBooking.raw);
    if (previousRaw !== nextRaw) {
      bookingDoc.rawBokunResponse = bokunBooking.raw;
      businessChanged = true;
    }
  }

  setSyncState(bookingDoc, {
    source,
    status: resolvedStatus,
    error: ""
  });

  await bookingDoc.save();

  if (businessChanged) {
    await updateInvoiceSnapshot(bookingDoc);
    await AuditLog.create({
      actorId: null,
      actorRole: source === "webhook" ? "bokun_webhook" : "bokun_poller",
      action: source === "webhook" ? "booking_synced_from_bokun_webhook" : "booking_synced_from_bokun_polling",
      entityType: "Booking",
      entityId: bookingDoc._id.toString(),
      reason: reason || "Booking updated from Bokun source of truth",
      requestId,
      before,
      after: {
        bookingStatus: bookingDoc.bookingStatus,
        travelDate: bookingDoc.travelDate,
        startTime: bookingDoc.startTime,
        bokunBookingId: bookingDoc.bokunBookingId,
        bokunConfirmationCode: bookingDoc.bokunConfirmationCode
      },
      metadata: {
        syncSource: source,
        bokunStatus: resolvedStatus
      }
    });
  }

  return {
    updated: businessChanged,
    bookingId: bookingDoc._id.toString(),
    bookingReference: bookingDoc.bookingReference,
    bookingStatus: bookingDoc.bookingStatus
  };
};

const markBookingSyncError = async ({ bookingDoc, source, errorMessage = "" }) => {
  setSyncState(bookingDoc, {
    source,
    status: bookingDoc.syncState?.lastBokunStatus || "",
    error: errorMessage
  });
  await bookingDoc.save();
};

const resolveLocalBooking = async ({
  bookingReference = "",
  bokunBookingId = "",
  bokunConfirmationCode = ""
} = {}) => {
  const orQuery = [
    bookingReference ? { bookingReference } : null,
    bokunBookingId ? { bokunBookingId } : null,
    bokunConfirmationCode ? { bokunConfirmationCode } : null
  ].filter(Boolean);

  if (!orQuery.length) {
    return null;
  }

  return Booking.findOne({ $or: orQuery });
};

const processSyncForBooking = async ({
  bookingDoc,
  bookingReference = "",
  bokunBookingId = "",
  bokunConfirmationCode = "",
  statusHint = "",
  source = "webhook",
  requestId = "",
  reason = "",
  eventType = "unknown"
}) => {
  const lookupKeys = resolveLookupKeys({
    booking: bookingDoc,
    bookingReference,
    bokunBookingId,
    bokunConfirmationCode
  });

  try {
    const bokunBooking = await lookupBokunBookingWithFallback({
      lookupKeys,
      requestId
    });

    if (bokunBooking) {
      return applyBokunSnapshotToBooking({
        bookingDoc,
        bokunBooking,
        statusHint,
        source,
        requestId,
        reason
      });
    }

    if (statusHint) {
      return applyBokunSnapshotToBooking({
        bookingDoc,
        bokunBooking: null,
        statusHint,
        source,
        requestId,
        reason: reason || `Bokun ${eventType} status fallback`
      });
    }

    setSyncState(bookingDoc, {
      source,
      status: bookingDoc.syncState?.lastBokunStatus || "",
      error: ""
    });
    await bookingDoc.save();

    return {
      updated: false,
      bookingId: bookingDoc._id.toString(),
      bookingReference: bookingDoc.bookingReference,
      bookingStatus: bookingDoc.bookingStatus
    };
  } catch (error) {
    await markBookingSyncError({
      bookingDoc,
      source,
      errorMessage: error.message
    });

    return {
      updated: false,
      failed: true,
      error: error.message,
      bookingId: bookingDoc._id.toString(),
      bookingReference: bookingDoc.bookingReference
    };
  }
};

const createSyncLogStarted = async ({ operation, details = {} }) =>
  SyncLog.create({
    source: "bokun",
    operation,
    status: "started",
    syncedCount: 0,
    details,
    startedAt: new Date()
  });

const finalizeSyncLog = async ({
  syncLog,
  status = "success",
  syncedCount = 0,
  details = {}
}) => {
  syncLog.status = status;
  syncLog.syncedCount = syncedCount;
  syncLog.completedAt = new Date();
  syncLog.details = {
    ...(syncLog.details || {}),
    ...details
  };
  await syncLog.save();
  return syncLog;
};

const verifyWebhookSecret = (headers = {}) => {
  const configured = toNonEmptyString(env.BOKUN_WEBHOOK_SECRET || "");
  if (!configured) {
    return true;
  }

  const provided = toNonEmptyString(
    headers["x-bokun-webhook-secret"] ||
      headers["x-webhook-secret"] ||
      headers["x-signature"] ||
      ""
  );

  if (!provided || provided.length !== configured.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(configured));
};

const buildSummaryCounts = (results = []) =>
  results.reduce(
    (acc, item) => {
      if (item.failed) {
        acc.failed += 1;
        return acc;
      }

      if (item.skipped) {
        acc.skipped += 1;
        return acc;
      }

      if (item.updated) {
        acc.updated += 1;
        return acc;
      }

      acc.unchanged += 1;
      return acc;
    },
    { processed: results.length, updated: 0, unchanged: 0, skipped: 0, failed: 0 }
  );

const handleBokunWebhook = async ({ payload, headers = {}, requestId = "" }) => {
  if (!verifyWebhookSecret(headers)) {
    throw new AppError("Invalid webhook secret", 401, "WEBHOOK_SECRET_INVALID");
  }

  const events = normalizeWebhookEvents(payload);
  const syncLog = await createSyncLogStarted({
    operation: "webhook_update",
    details: {
      eventCount: events.length
    }
  });

  try {
    const results = [];

    for (const event of events) {
      const context = extractContextFromEvent(event);

      if (!context.bookingReference && !context.bokunBookingId && !context.bokunConfirmationCode) {
        results.push({
          skipped: true,
          reason: "missing_identifiers",
          eventType: context.eventType
        });
        continue;
      }

      const bookingDoc = await resolveLocalBooking({
        bookingReference: context.bookingReference,
        bokunBookingId: context.bokunBookingId,
        bokunConfirmationCode: context.bokunConfirmationCode
      });

      if (!bookingDoc) {
        results.push({
          skipped: true,
          reason: "booking_not_found_locally",
          bookingReference: context.bookingReference,
          bokunBookingId: context.bokunBookingId
        });
        continue;
      }

      const result = await processSyncForBooking({
        bookingDoc,
        bookingReference: context.bookingReference,
        bokunBookingId: context.bokunBookingId,
        bokunConfirmationCode: context.bokunConfirmationCode,
        statusHint: context.statusHint,
        source: "webhook",
        requestId,
        reason: `Webhook event ${context.eventType}`,
        eventType: context.eventType
      });

      results.push({
        ...result,
        eventType: context.eventType
      });
    }

    const summary = buildSummaryCounts(results);
    await finalizeSyncLog({
      syncLog,
      status: summary.failed ? "failed" : "success",
      syncedCount: summary.updated,
      details: {
        ...summary,
        results: results.slice(0, 25)
      }
    });

    await AuditLog.create({
      actorId: null,
      actorRole: "bokun_webhook",
      action: "webhook_received",
      entityType: "SyncLog",
      entityId: syncLog._id.toString(),
      requestId,
      metadata: {
        webhookSummary: summary
      }
    });

    return {
      received: true,
      syncLogId: syncLog._id,
      summary
    };
  } catch (error) {
    await finalizeSyncLog({
      syncLog,
      status: "failed",
      syncedCount: 0,
      details: {
        error: error.message
      }
    });

    throw error;
  }
};

const pollBookingUpdates = async ({
  requestId = "",
  source = "polling",
  limit
} = {}) => {
  if (bookingSyncRunning) {
    return {
      skipped: true,
      reason: "sync_already_running"
    };
  }

  bookingSyncRunning = true;
  const internalRequestId = requestId || buildInternalRequestId();
  const batchSize = Math.max(
    1,
    Math.min(100, Number(limit || env.BOKUN_BOOKING_SYNC_BATCH_SIZE || 20))
  );

  const syncLog = await createSyncLogStarted({
    operation: "booking_sync",
    details: {
      source,
      batchSize
    }
  });

  try {
    const candidates = await Booking.find({
      bokunBookingId: { $exists: true, $ne: "" },
      bookingStatus: { $in: ACTIVE_BOOKING_STATUSES }
    })
      .sort({ "syncState.lastBokunSyncAt": 1, updatedAt: 1 })
      .limit(batchSize);

    const results = [];
    for (const bookingDoc of candidates) {
      const result = await processSyncForBooking({
        bookingDoc,
        source,
        requestId: internalRequestId,
        reason: "Polling fallback sync"
      });
      results.push(result);
    }

    const summary = buildSummaryCounts(results);
    await finalizeSyncLog({
      syncLog,
      status: summary.failed ? "failed" : "success",
      syncedCount: summary.updated,
      details: {
        ...summary,
        source,
        batchSize,
        results: results.slice(0, 25)
      }
    });

    if (summary.failed > 0) {
      logger.warn("Bokun polling sync completed with failures", {
        requestId: internalRequestId,
        ...summary
      });
    } else {
      logger.info("Bokun polling sync completed", {
        requestId: internalRequestId,
        ...summary
      });
    }

    return {
      syncLogId: syncLog._id,
      ...summary
    };
  } catch (error) {
    await finalizeSyncLog({
      syncLog,
      status: "failed",
      syncedCount: 0,
      details: {
        source,
        batchSize,
        error: error.message
      }
    });

    logger.error("Bokun polling sync failed", {
      requestId: internalRequestId,
      error: error.message
    });

    throw error;
  } finally {
    bookingSyncRunning = false;
  }
};

module.exports = {
  handleBokunWebhook,
  pollBookingUpdates
};
