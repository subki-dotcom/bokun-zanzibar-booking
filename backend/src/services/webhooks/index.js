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
const invoicesService = require("../invoices");
const bokunConfirmedBookingsService = require("../bokunConfirmedBookings");
const { normalizeBokunBookingStatus } = require("../../integrations/bokun/bookingStatus.adapter");
const { mapBokunSalesChannel } = require("../../integrations/bokun/salesChannel.adapter");

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
  bokunBookingId = "",
  bokunConfirmationCode = ""
} = {}) => {
  return Array.from(
    new Set(
      [
        bokunBookingId,
        bokunConfirmationCode,
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latestBooking = await Booking.findById(bookingDoc._id);
    if (!latestBooking) return;
    const productSnapshot = await ProductSnapshot.findOne({
      bokunProductId: latestBooking.bokunProductId
    }).lean();
    const invoiceSnapshot = await invoicesService.buildInvoiceSnapshot({
      booking: latestBooking.toObject(),
      productSnapshot
    });
    const version = Number(latestBooking.__v || 0);
    const update = await Booking.updateOne(
      { _id: latestBooking._id, __v: version },
      { $set: { invoiceSnapshot }, $inc: { __v: 1 } },
      { runValidators: true }
    );
    if ((update.matchedCount ?? update.n ?? 0) === 1) {
      bookingDoc.invoiceSnapshot = invoiceSnapshot;
      bookingDoc.__v = version + 1;
      bookingDoc.unmarkModified?.("invoiceSnapshot");
      await invoicesService.upsertInvoiceFromSnapshot(invoiceSnapshot);
      return;
    }
  }
  const error = new Error("Booking changed repeatedly while updating its invoice snapshot");
  error.code = "BOKUN_SYNC_CONCURRENT_UPDATE";
  throw error;
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

const applyMappedTransactionCurrency = ({ bookingDoc, mappedBooking }) => {
  if (!String(bookingDoc?.bokunCurrencySource || "").startsWith("BOKUN_") ||
      !mappedBooking || mappedBooking.validationErrors.includes("currency")) return false;
  const snapshot = mappedBooking.snapshot;
  if (Number(bookingDoc.amount) === Number(snapshot.amount) &&
      bookingDoc.currency === snapshot.currency &&
      bookingDoc.transactionCurrency === snapshot.transactionCurrency) return false;
  bookingDoc.amount = snapshot.amount;
  bookingDoc.currency = snapshot.currency;
  bookingDoc.transactionCurrency = snapshot.transactionCurrency;
  bookingDoc.bokunCurrencySource = snapshot.bokunCurrencySource;
  bookingDoc.pricingSnapshot = snapshot.pricingSnapshot;
  return true;
};

const BOKUN_SYNC_FIELDS = [
  "bookingReference", "bokunBookingId", "bokunConfirmationCode", "travelDate", "startTime",
  "amount", "currency", "transactionCurrency", "bokunCurrencySource", "pricingSnapshot",
  "bookingStatus", "cancellation", "supplierStatus", "supplierStatusUpdatedAt", "supplierFailureReason",
  "operationalSource", "salesChannel", "rawBokunResponse", "bokunOperationalEvidence", "bokunStatus",
  "bokunImport", "syncState"
];

const plainBooking = (bookingDoc) =>
  typeof bookingDoc.toObject === "function" ? bookingDoc.toObject() : bookingDoc;

const snapshotBokunSyncFields = (bookingDoc) => {
  const plain = plainBooking(bookingDoc);
  return Object.fromEntries(BOKUN_SYNC_FIELDS
    .filter((field) => Object.prototype.hasOwnProperty.call(plain, field))
    .map((field) => [field, plain[field]]));
};

const updateBokunFieldsWithRetry = async ({ bookingId, mutate, BookingModel = Booking, maxAttempts = 3 }) => {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const bookingDoc = await BookingModel.findById(bookingId);
    if (!bookingDoc) throw new AppError("Booking not found during Bókun sync", 404, "BOOKING_NOT_FOUND");

    const before = snapshotBokunSyncFields(bookingDoc);
    const result = mutate(bookingDoc);
    const after = snapshotBokunSyncFields(bookingDoc);
    const patch = Object.fromEntries(Object.entries(after).filter(([field, value]) =>
      JSON.stringify(value) !== JSON.stringify(before[field])));
    const version = Number(bookingDoc.__v || 0);
    const update = await BookingModel.updateOne(
      { _id: bookingDoc._id, __v: version },
      { $set: patch, $inc: { __v: 1 } },
      { runValidators: true }
    );

    if ((update.matchedCount ?? update.n ?? 0) === 1) {
      bookingDoc.__v = version + 1;
      for (const field of Object.keys(patch)) bookingDoc.unmarkModified?.(field);
      return { bookingDoc, before, ...result };
    }
  }

  const error = new Error("Booking changed repeatedly during Bókun sync");
  error.code = "BOKUN_SYNC_CONCURRENT_UPDATE";
  throw error;
};

const applyBokunSnapshotToBooking = async ({
  bookingDoc,
  bokunBooking = null,
  statusHint = "",
  source = "system",
  requestId = "",
  reason = ""
}) => {
  const bookingId = bookingDoc._id;
  const resolvedStatus = bokunBooking?.status || statusHint || "";
  const strictStatus = normalizeBokunBookingStatus(bokunBooking?.raw || bokunBooking || { status: resolvedStatus });
  const mappedStatus = strictStatus.known ? strictStatus.localBookingStatus : mapBokunStatusToLocal(resolvedStatus);
  const mappedBooking = bokunBooking
    ? require("../../integrations/bokun/confirmedBooking.mapper").mapBokunBookingForImport({ bokunBooking })
    : null;
  const { bookingDoc: syncedBookingDoc, before: beforeState, businessChanged } = await updateBokunFieldsWithRetry({
    bookingId,
    mutate: (currentBooking) => {
      let changed = false;
      const mappedChannel = mapBokunSalesChannel(bokunBooking?.raw || bokunBooking || {}, currentBooking.sourceChannel || "");
      const assignIfChanged = (key, value) => {
        const nextValue = toNonEmptyString(value);
        if (!nextValue || currentBooking[key] === nextValue) return;
        currentBooking[key] = nextValue;
        changed = true;
      };

      assignIfChanged("bokunBookingId", bokunBooking?.bokunBookingId || "");
      if (!toNonEmptyString(currentBooking.bookingReference)) {
        assignIfChanged("bookingReference", bokunBooking?.bookingReference || "");
      }
      assignIfChanged("bokunConfirmationCode", bokunBooking?.confirmationCode || "");
      assignIfChanged("travelDate", bokunBooking?.travelDate || "");
      assignIfChanged("startTime", bokunBooking?.startTime || "");

      // Poll responses may be stale; financial currency snapshots have their own evidence pipeline.
      if (source !== "polling" && applyMappedTransactionCurrency({ bookingDoc: currentBooking, mappedBooking })) changed = true;

      if (mappedStatus && currentBooking.bookingStatus !== mappedStatus) {
        currentBooking.bookingStatus = mappedStatus;
        if (mappedStatus === BOOKING_STATUS.CANCELLED && !currentBooking.cancellation?.cancelledAt) {
          currentBooking.cancellation = {
            reason: reason || "Updated from Bokun status sync",
            cancelledAt: new Date(),
            cancelledBy: "bokun_sync"
          };
        }
        changed = true;
      }

      if (currentBooking.bokunBookingId) {
        const supplierStatus = currentBooking.bookingStatus === BOOKING_STATUS.CONFIRMED ? "confirmed" : "supplier_pending";
        if (currentBooking.supplierStatus !== supplierStatus) {
          currentBooking.supplierStatus = supplierStatus;
          currentBooking.supplierStatusUpdatedAt = new Date();
          currentBooking.supplierFailureReason = "";
          changed = true;
        }
      }

      if (bokunBooking?.raw && JSON.stringify(currentBooking.rawBokunResponse || null) !== JSON.stringify(bokunBooking.raw)) {
        currentBooking.rawBokunResponse = bokunBooking.raw;
      }
      if (mappedBooking?.snapshot?.bokunOperationalEvidence) {
        currentBooking.bokunOperationalEvidence = mappedBooking.snapshot.bokunOperationalEvidence;
      }

      if (bokunBooking || resolvedStatus) {
        currentBooking.operationalSource = "BOKUN";
        currentBooking.salesChannel = currentBooking.salesChannel || mappedChannel.salesChannel;
        currentBooking.bokunStatus = {
          raw: strictStatus.rawStatus,
          normalized: strictStatus.normalizedStatus,
          sourceField: strictStatus.sourceField,
          mappedAt: new Date()
        };
        currentBooking.bokunImport = {
          ...(currentBooking.bokunImport || {}),
          firstImportedAt: currentBooking.bokunImport?.firstImportedAt || null,
          lastImportedAt: currentBooking.bokunImport?.lastImportedAt || null,
          lastSyncedAt: new Date(),
          lastSyncSource: source,
          lastSyncRequestId: requestId,
          lastChangeType: changed ? "updated" : "unchanged",
          lastError: "",
          rawSalesChannel: mappedChannel.rawChannel || currentBooking.bokunImport?.rawSalesChannel || "",
          salesChannelSourceField: mappedChannel.sourceField || currentBooking.bokunImport?.salesChannelSourceField || ""
        };
      }

      setSyncState(currentBooking, { source, status: resolvedStatus, error: "" });
      return { businessChanged: changed };
    }
  });
  const before = {
    bookingStatus: beforeState.bookingStatus,
    travelDate: beforeState.travelDate,
    startTime: beforeState.startTime,
    bokunBookingId: beforeState.bokunBookingId,
    bokunConfirmationCode: beforeState.bokunConfirmationCode
  };

  const paymentSync = bokunBooking ? await require('../bookingPayment/sync').syncBokunPayment({
    booking: syncedBookingDoc, payload: bokunBooking.raw || bokunBooking, source, requestId
  }) : null;

  if (businessChanged) {
    await updateInvoiceSnapshot(syncedBookingDoc);
    await AuditLog.create({
      actorId: null,
      actorRole: source === "webhook" ? "bokun_webhook" : "bokun_poller",
      action: source === "webhook" ? "booking_synced_from_bokun_webhook" : "booking_synced_from_bokun_polling",
      entityType: "Booking",
      entityId: syncedBookingDoc._id.toString(),
      reason: reason || "Booking updated from Bokun source of truth",
      requestId,
      before,
      after: {
        bookingStatus: syncedBookingDoc.bookingStatus,
        travelDate: syncedBookingDoc.travelDate,
        startTime: syncedBookingDoc.startTime,
        bokunBookingId: syncedBookingDoc.bokunBookingId,
        bokunConfirmationCode: syncedBookingDoc.bokunConfirmationCode
      },
      metadata: {
        syncSource: source,
        bokunStatus: resolvedStatus
      }
    });
  }

  return {
    updated: businessChanged || Boolean(paymentSync?.changed),
    bookingId: syncedBookingDoc._id.toString(),
    bookingReference: syncedBookingDoc.bookingReference,
    bookingStatus: syncedBookingDoc.bookingStatus
  };
};

const markBookingSyncError = async ({ bookingDoc, source, errorMessage = "" }) => {
  await Booking.updateOne({ _id: bookingDoc._id }, {
    $set: {
      "syncState.lastBokunSyncAt": new Date(),
      "syncState.lastBokunSyncSource": source,
      "syncState.lastBokunSyncError": toNonEmptyString(errorMessage)
    },
    $inc: { __v: 1 }
  });
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

    await Booking.updateOne({ _id: bookingDoc._id }, {
      $set: {
        "syncState.lastBokunSyncAt": new Date(),
        "syncState.lastBokunSyncSource": source,
        "syncState.lastBokunSyncError": ""
      },
      $inc: { __v: 1 }
    });

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

const reconcileExistingBokunBooking = async ({
  bookingDoc,
  requestId = "",
  source = "payment_finalization",
  reason = "Checked Bokun before retrying paid booking finalization"
} = {}) => {
  if (!bookingDoc) {
    throw new AppError("Booking is required for Bokun reconciliation", 400, "BOOKING_REQUIRED");
  }


  const lookupKeys = resolveLookupKeys({ booking: bookingDoc });
  if (!lookupKeys.length) {
    return { found: false, booking: bookingDoc, skipped: "supplier_identifier_missing" };
  }

  const bokunBooking = await lookupBokunBookingWithFallback({
    lookupKeys,
    requestId
  });

  if (!bokunBooking?.bokunBookingId) {
    return { found: false, booking: bookingDoc };
  }

  await applyBokunSnapshotToBooking({
    bookingDoc,
    bokunBooking,
    source,
    requestId,
    reason
  });

  return {
    found: true,
    booking: await Booking.findById(bookingDoc._id),
    bokunBooking
  };
};

const syncBokunOperationalEvidence = async ({
  bookingDoc,
  requestId = "",
  source = "owner_controlled_operational_evidence"
} = {}) => {
  if (!bookingDoc) {
    throw new AppError("Booking is required for Bókun operational evidence sync", 400, "BOOKING_REQUIRED");
  }

  const lookupKeys = resolveLookupKeys({ booking: bookingDoc });
  const bokunBooking = await lookupBokunBookingWithFallback({ lookupKeys, requestId });
  if (!bokunBooking) return { found: false, updated: false, booking: bookingDoc };

  const mapped = require("../../integrations/bokun/confirmedBooking.mapper").mapBokunBookingForImport({ bokunBooking });
  const evidence = mapped.snapshot.bokunOperationalEvidence || {};
  if (!evidence.activityStatus) return { found: true, updated: false, booking: bookingDoc, evidence: null };

  const before = bookingDoc.bokunOperationalEvidence || {};
  const changed = JSON.stringify(before) !== JSON.stringify(evidence);
  if (changed) {
    bookingDoc.bokunOperationalEvidence = evidence;
    await bookingDoc.save();
    await AuditLog.create({
      actorId: null,
      actorRole: "system",
      action: "bokun_operational_evidence_synced",
      entityType: "Booking",
      entityId: bookingDoc._id.toString(),
      reference: bookingDoc.bookingReference,
      requestId,
      reason: "Bókun activity operational evidence synchronized without completion or payment changes",
      before: { bokunOperationalEvidence: before },
      after: { bokunOperationalEvidence: evidence },
      metadata: { source }
    });
  }

  return { found: true, updated: changed, booking: bookingDoc, evidence };
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
    // In production we require a configured webhook secret. In non-production
    // environments allow missing secret for developer convenience.
    if (String(env.NODE_ENV || "").trim() === "production") {
      logger.error("Bokun webhook secret not configured in production");
      return false;
    }
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

const processCandidatesIndependently = async ({ candidates = [], processCandidate, onFailure = () => {} }) => {
  const results = [];
  for (const bookingDoc of candidates) {
    try {
      results.push(await processCandidate(bookingDoc));
    } catch (error) {
      onFailure(bookingDoc, error);
      results.push({
        failed: true,
        bookingId: bookingDoc._id?.toString(),
        bookingReference: bookingDoc.bookingReference,
        error: error.message
      });
    }
  }
  return results;
};

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
        // If enabled, attempt a safe confirmed-booking import for missing bookings.
        if (env.BOKUN_WEBHOOK_IMPORT_MISSING) {
          const lookupReference = context.bookingReference || context.bokunBookingId || context.bokunConfirmationCode;
          if (!lookupReference) {
            results.push({
              skipped: true,
              reason: "booking_not_found_locally",
              bookingReference: context.bookingReference,
              bokunBookingId: context.bokunBookingId
            });
            continue;
          }

          try {
            const importRes = await bokunConfirmedBookingsService.manualResync({
              reference: lookupReference,
              source: "webhook_create",
              requestId,
              dryRun: false
            });

            // manualResync returns { syncLogId, result }
            results.push({
              updated: importRes?.result ? importRes.result.action !== "unchanged" : false,
              action: importRes?.result?.action || "imported",
              bookingReference: importRes?.result?.bookingReference || lookupReference
            });
            continue;
          } catch (err) {
            results.push({
              failed: true,
              error: err?.message || String(err || "unknown"),
              bookingReference: lookupReference
            });
            continue;
          }
        }

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

    const results = await processCandidatesIndependently({
      candidates,
      processCandidate: (bookingDoc) => processSyncForBooking({
          bookingDoc,
          source,
          requestId: internalRequestId,
          reason: "Polling fallback sync"
      }),
      onFailure: (bookingDoc, error) => {
        logger.error("Bokun polling sync failed for booking", {
          requestId: internalRequestId,
          bookingId: bookingDoc._id?.toString(),
          bookingReference: bookingDoc.bookingReference,
          error: error.message
        });
      }
    });

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
  pollBookingUpdates,
  reconcileExistingBokunBooking,
  syncBokunOperationalEvidence,
  __testables: { applyMappedTransactionCurrency, updateBokunFieldsWithRetry, processCandidatesIndependently }
};
