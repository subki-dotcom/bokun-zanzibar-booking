const crypto = require("crypto");
const Booking = require("../../models/Booking");
const Customer = require("../../models/Customer");
const SyncLog = require("../../models/SyncLog");
const AuditLog = require("../../models/AuditLog");
const bokunService = require("../bokun");
const AppError = require("../../utils/AppError");
const { env } = require("../../config/env");
const {
  mapBokunBookingForImport,
  resolveBookingLookupReference
} = require("../../integrations/bokun/confirmedBooking.mapper");

const IMPORT_OPERATION = "confirmed_booking_import";
const RESYNC_OPERATION = "confirmed_booking_resync";

let bulkSyncRunning = false;

const normalizeToken = (value = "") => String(value || "").trim();

const ensureArray = (value) => (Array.isArray(value) ? value : []);

const stableStringify = (value) => {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const normalizeOperationalDatesForComparison = (dates = {}) => {
  const plain = typeof dates?.toObject === "function" ? dates.toObject() : dates || {};
  return Object.entries(plain).reduce((normalized, [key, value]) => {
    if (key === "mappedAt") return normalized;
    normalized[key] = typeof value?.toObject === "function" ? value.toObject() : value;
    return normalized;
  }, {});
};

const hashSnapshot = (snapshot = {}) =>
  crypto
    .createHash("sha256")
    .update(stableStringify({
      bookingReference: snapshot.bookingReference,
      bokunBookingId: snapshot.bokunBookingId,
      confirmationCode: snapshot.confirmationCode,
      bokunExternalBookingReference: snapshot.bokunExternalBookingReference,
      externalChannelReference: snapshot.externalChannelReference,
      bokunProductId: snapshot.bokunProductId,
      bokunOptionId: snapshot.bokunOptionId,
      travelDate: snapshot.travelDate,
      startTime: snapshot.startTime,
      bokunOperationalDates: normalizeOperationalDatesForComparison(snapshot.bokunOperationalDates),
      paxSummary: snapshot.paxSummary,
      amount: snapshot.amount,
      currency: snapshot.currency,
      salesChannel: snapshot.salesChannel
    }))
    .digest("hex");

const getDefaultBookingStatuses = () =>
  String(env.BOKUN_CONFIRMED_BOOKING_IMPORT_STATUSES || "confirmed,cancelled")
    .split(",")
    .map((status) => status.trim())
    .filter(Boolean);

const maybeToObject = (document) =>
  typeof document?.toObject === "function" ? document.toObject() : document;

const buildBookingLookupQuery = (snapshot = {}) => {
  const or = [
    snapshot.bookingReference ? { bookingReference: snapshot.bookingReference } : null,
    snapshot.bokunBookingId ? { bokunBookingId: snapshot.bokunBookingId } : null,
    snapshot.confirmationCode ? { bokunConfirmationCode: snapshot.confirmationCode } : null,
    snapshot.bokunExternalBookingReference ? { bokunExternalBookingReference: snapshot.bokunExternalBookingReference } : null
  ].filter(Boolean);

  if (!or.length) {
    throw new AppError("Bokun booking does not include any stable local identifier", 422, "BOKUN_BOOKING_IDENTIFIER_MISSING");
  }

  return { $or: or };
};

const sameJson = (left, right) => stableStringify(left || {}) === stableStringify(right || {});

const resolveChangeType = ({ existing = null, snapshot = {}, snapshotHash = "" } = {}) => {
  if (!existing) return "imported";
  if (existing.bokunImport?.snapshotHash && existing.bokunImport.snapshotHash === snapshotHash) {
    return "unchanged";
  }

  const operationalChanged =
    String(existing.travelDate || "") !== String(snapshot.travelDate || "") ||
    String(existing.startTime || "") !== String(snapshot.startTime || "") ||
    String(existing.bokunProductId || "") !== String(snapshot.bokunProductId || "") ||
    String(existing.bokunOptionId || "") !== String(snapshot.bokunOptionId || "") ||
    String(existing.bokunExternalBookingReference || "") !== String(snapshot.bokunExternalBookingReference || "") ||
    String(existing.externalChannelReference || "") !== String(snapshot.externalChannelReference || "") ||
    !sameJson(
      normalizeOperationalDatesForComparison(existing.bokunOperationalDates),
      normalizeOperationalDatesForComparison(snapshot.bokunOperationalDates)
    ) ||
    !sameJson(existing.paxSummary, snapshot.paxSummary);

  return operationalChanged ? "amended" : "updated";
};

const shouldPreserveExistingFinancials = (existing = null) => {
  if (!existing) return false;
  const sourceChannel = String(existing.sourceChannel || "").toLowerCase();
  return Boolean(
    existing.paymentTransactionId ||
      existing.dpoTransactionToken ||
      (sourceChannel === "direct_website" && ["paid", "partial", "processing"].includes(String(existing.paymentStatus || "")))
  );
};

const inferExistingSalesChannel = (existing = null) => {
  const sourceChannel = String(existing?.sourceChannel || "").toLowerCase();
  if (!sourceChannel) return "";
  if (sourceChannel === "direct_website" || sourceChannel === "website") return "DIRECT_WEBSITE";
  if (sourceChannel === "agent") return "AGENT";
  if (sourceChannel === "whatsapp") return "WHATSAPP";
  if (sourceChannel === "walk_in") return "WALK_IN";
  return "";
};

const createCustomerService = ({ CustomerModel = Customer } = {}) => {
  const upsertCustomerFromSnapshot = async (snapshot = {}) => {
    const input = snapshot.customer || {};
    const email = normalizeToken(input.email).toLowerCase();
    if (!email) {
      return null;
    }

    let customer = await CustomerModel.findOne({ email });
    if (!customer) {
      customer = await CustomerModel.create({
        firstName: input.firstName || "Guest",
        lastName: input.lastName || "Customer",
        email,
        phone: input.phone || "",
        country: input.country || "",
        hotelName: input.hotelName || "",
        pickupPlaceId: input.pickupPlaceId || "",
        bookings: []
      });
      return customer;
    }

    let changed = false;
    ["firstName", "lastName", "phone", "country", "hotelName", "pickupPlaceId"].forEach((field) => {
      if (input[field] && customer[field] !== input[field]) {
        customer[field] = input[field];
        changed = true;
      }
    });
    if (changed && typeof customer.save === "function") {
      await customer.save();
    }
    return customer;
  };

  const linkBookingToCustomer = async ({ customer, booking }) => {
    if (!customer || !booking?._id || !Array.isArray(customer.bookings)) return;
    if (customer.bookings.some((id) => String(id) === String(booking._id))) return;
    customer.bookings.push(booking._id);
    if (typeof customer.save === "function") {
      await customer.save();
    }
  };

  return {
    upsertCustomerFromSnapshot,
    linkBookingToCustomer
  };
};

const summarizeImportResults = (results = []) =>
  results.reduce(
    (summary, result) => {
      const action = result.action || "unknown";
      if (action === "imported") summary.imported += 1;
      else if (action === "amended") summary.amended += 1;
      else if (action === "updated") summary.updated += 1;
      else if (action === "cancelled") summary.cancelled += 1;
      else if (action === "unchanged") summary.unchanged += 1;
      else if (action === "skipped") summary.skipped += 1;
      else if (action === "failed") summary.failed += 1;
      summary.processed += 1;
      return summary;
    },
    { processed: 0, imported: 0, amended: 0, updated: 0, cancelled: 0, unchanged: 0, skipped: 0, failed: 0 }
  );

const buildBookingPatch = ({
  mapped,
  existing = null,
  customer = null,
  snapshotHash,
  source,
  requestId,
  nowDate
}) => {
  const { snapshot, status, channel } = mapped;
  const preserveFinancials = shouldPreserveExistingFinancials(existing);
  const firstImportedAt = existing?.bokunImport?.firstImportedAt || nowDate;
  const existingSourceChannel = normalizeToken(existing?.sourceChannel);
  const salesChannel = existing?.salesChannel || inferExistingSalesChannel(existing) || snapshot.salesChannel;
  const bokunOperationalDates = {
    ...(snapshot.bokunOperationalDates || {}),
    mappedAt: nowDate
  };

  const patch = {
    bookingReference: existing?.bookingReference || snapshot.bookingReference,
    bokunBookingId: snapshot.bokunBookingId,
    bokunConfirmationCode: snapshot.confirmationCode,
    bokunExternalBookingReference: snapshot.bokunExternalBookingReference || existing?.bokunExternalBookingReference || "",
    bokunProductId: snapshot.bokunProductId,
    bokunOptionId: snapshot.bokunOptionId,
    productTitle: snapshot.productTitle,
    optionTitle: snapshot.optionTitle,
    travelDate: snapshot.travelDate,
    startTime: snapshot.startTime,
    priceCatalog: snapshot.priceCatalog,
    paxSummary: snapshot.paxSummary,
    priceCategoryParticipants: snapshot.priceCategoryParticipants,
    customer: {
      customerId: customer?._id || existing?.customer?.customerId || null,
      firstName: snapshot.customer.firstName || existing?.customer?.firstName || "Guest",
      lastName: snapshot.customer.lastName || existing?.customer?.lastName || "Customer",
      email: snapshot.customer.email || existing?.customer?.email || "",
      phone: snapshot.customer.phone || existing?.customer?.phone || "",
      country: snapshot.customer.country || existing?.customer?.country || "",
      hotelName: snapshot.customer.hotelName || existing?.customer?.hotelName || "",
      pickupPlaceId: snapshot.customer.pickupPlaceId || existing?.customer?.pickupPlaceId || ""
    },
    bookingStatus: "confirmed",
    supplierStatus: "confirmed",
    supplierStatusUpdatedAt: nowDate,
    supplierFailureReason: "",
    sourceChannel: existingSourceChannel || snapshot.sourceChannel,
    rawChannelSource: snapshot.rawChannelSource || channel.rawChannel || existing?.rawChannelSource || "",
    externalChannelReference: snapshot.externalChannelReference || existing?.externalChannelReference || "",
    operationalSource: "BOKUN",
    salesChannel,
    createdByRole: existing?.createdByRole || "bokun_import",
    createdByUser: existing?.createdByUser || { id: null, name: "Bokun confirmed booking import" },
    bokunStatus: {
      raw: status.rawStatus,
      normalized: status.normalizedStatus,
      sourceField: status.sourceField,
      mappedAt: nowDate
    },
    bokunOperationalDates,
    bokunImport: {
      ...(existing?.bokunImport || {}),
      firstImportedAt,
      lastImportedAt: nowDate,
      lastSyncedAt: nowDate,
      lastSyncSource: source,
      lastSyncRequestId: requestId,
      lastChangeType: resolveChangeType({ existing, snapshot, snapshotHash }),
      lastError: "",
      snapshotHash,
      rawSalesChannel: channel.rawChannel || "",
      salesChannelSourceField: channel.sourceField || ""
    },
    rawBokunResponse: snapshot.rawBokunResponse
  };

  if (preserveFinancials) {
    patch.paymentStatus = existing.paymentStatus;
    patch.paymentMethod = existing.paymentMethod;
    patch.amount = existing.amount;
    patch.currency = existing.currency;
    patch.pricingSnapshot = existing.pricingSnapshot;
    patch.invoiceSnapshot = existing.invoiceSnapshot;
  } else {
    patch.paymentStatus = snapshot.paymentStatus;
    patch.paymentMethod = snapshot.paymentMethod || "bokun_channel";
    patch.amount = snapshot.amount;
    patch.currency = snapshot.currency;
    patch.pricingSnapshot = snapshot.pricingSnapshot;
  }

  return patch;
};

const buildCancellationPatch = ({ mapped, existing, source, requestId, nowDate }) => {
  const { snapshot, status, channel } = mapped;
  const bokunOperationalDates = {
    ...(snapshot.bokunOperationalDates || {}),
    mappedAt: nowDate
  };
  const bokunCancellationDate = snapshot.bokunOperationalDates?.cancellationDate?.normalizedAt || snapshot.cancellationDate;
  const salesChannel = existing.salesChannel || inferExistingSalesChannel(existing) || snapshot.salesChannel;

  return {
    operationalSource: "BOKUN",
    salesChannel,
    bokunBookingId: snapshot.bokunBookingId || existing.bokunBookingId,
    bokunConfirmationCode: snapshot.confirmationCode || existing.bokunConfirmationCode,
    bokunExternalBookingReference: snapshot.bokunExternalBookingReference || existing.bokunExternalBookingReference || "",
    rawChannelSource: snapshot.rawChannelSource || channel.rawChannel || existing.rawChannelSource || "",
    externalChannelReference: snapshot.externalChannelReference || existing.externalChannelReference || "",
    bokunOperationalDates,
    bookingStatus: "cancelled",
    supplierStatus: existing.supplierStatus === "confirmed" ? "confirmed" : existing.supplierStatus,
    cancellation: {
      reason: existing.cancellation?.reason || "Bokun booking status synchronized as cancelled",
      cancelledAt: existing.cancellation?.cancelledAt || (bokunCancellationDate ? new Date(bokunCancellationDate) : nowDate),
      cancelledBy: existing.cancellation?.cancelledBy || "bokun_import"
    },
    bokunStatus: {
      raw: status.rawStatus,
      normalized: status.normalizedStatus,
      sourceField: status.sourceField,
      mappedAt: nowDate
    },
    bokunImport: {
      ...(existing.bokunImport || {}),
      lastSyncedAt: nowDate,
      lastImportedAt: existing.bokunImport?.lastImportedAt || null,
      lastSyncSource: source,
      lastSyncRequestId: requestId,
      lastChangeType: "cancelled",
      lastError: "",
      rawSalesChannel: channel.rawChannel || existing.bokunImport?.rawSalesChannel || "",
      salesChannelSourceField: channel.sourceField || existing.bokunImport?.salesChannelSourceField || ""
    },
    rawBokunResponse: snapshot.rawBokunResponse
  };
};

const createBokunConfirmedBookingImportService = ({
  BookingModel = Booking,
  CustomerModel = Customer,
  SyncLogModel = SyncLog,
  AuditLogModel = AuditLog,
  bokun = bokunService,
  now = () => new Date()
} = {}) => {
  const customerService = createCustomerService({ CustomerModel });

  const recordAudit = async ({ action, booking, requestId = "", reason = "", before = null, after = null, metadata = {} }) => {
    await AuditLogModel.create({
      actorId: null,
      actorRole: "bokun_import",
      action,
      entityType: "Booking",
      entityId: String(booking?._id || ""),
      reason,
      requestId,
      before,
      after,
      metadata
    });
  };

  const upsertConfirmedBooking = async ({ mapped, source = "manual", requestId = "", dryRun = false } = {}) => {
    const { snapshot, status, validationErrors } = mapped;
    if (!mapped.isImportableConfirmed) {
      return {
        action: "skipped",
        reason: validationErrors.length ? "snapshot_incomplete" : "not_confirmed",
        validationErrors,
        rawStatus: status.rawStatus,
        normalizedStatus: status.normalizedStatus
      };
    }

    const existing = await BookingModel.findOne(buildBookingLookupQuery(snapshot));
    const existingBefore = existing ? {
      bookingStatus: existing.bookingStatus,
      travelDate: existing.travelDate,
      startTime: existing.startTime,
      bokunBookingId: existing.bokunBookingId,
      bokunConfirmationCode: existing.bokunConfirmationCode,
      bokunExternalBookingReference: existing.bokunExternalBookingReference,
      bokunOperationalDates: normalizeOperationalDatesForComparison(existing.bokunOperationalDates),
      operationalSource: existing.operationalSource,
      salesChannel: existing.salesChannel,
      amount: existing.amount,
      currency: existing.currency,
      paymentStatus: existing.paymentStatus
    } : null;
    const snapshotHash = hashSnapshot(snapshot);
    const changeType = resolveChangeType({ existing, snapshot, snapshotHash });

    if (dryRun) {
      return {
        action: existing ? changeType : "imported",
        dryRun: true,
        bookingReference: existing?.bookingReference || snapshot.bookingReference,
        bokunBookingId: snapshot.bokunBookingId,
        bokunExternalBookingReference: snapshot.bokunExternalBookingReference || "",
        bokunOperationalDates: normalizeOperationalDatesForComparison(snapshot.bokunOperationalDates)
      };
    }

    const customer = await customerService.upsertCustomerFromSnapshot(snapshot);
    const patch = buildBookingPatch({
      mapped,
      existing,
      customer,
      snapshotHash,
      source,
      requestId,
      nowDate: now()
    });

    let booking;
    if (existing) {
      Object.assign(existing, patch);
      booking = typeof existing.save === "function" ? await existing.save() : existing;
    } else {
      booking = await BookingModel.create(patch);
    }

    await customerService.linkBookingToCustomer({ customer, booking });

    if (changeType !== "unchanged") {
      await recordAudit({
        action: changeType === "imported" ? "bokun_confirmed_booking_imported" : "bokun_confirmed_booking_synchronized",
        booking,
        requestId,
        reason: changeType === "imported"
          ? "Imported confirmed booking from Bokun source of truth"
          : "Synchronized confirmed booking from Bokun source of truth",
        before: existingBefore,
        after: {
          bookingReference: booking.bookingReference,
          bookingStatus: booking.bookingStatus,
          travelDate: booking.travelDate,
          startTime: booking.startTime,
          bokunBookingId: booking.bokunBookingId,
          bokunConfirmationCode: booking.bokunConfirmationCode,
          bokunExternalBookingReference: booking.bokunExternalBookingReference,
          bokunOperationalDates: normalizeOperationalDatesForComparison(booking.bokunOperationalDates),
          operationalSource: booking.operationalSource,
          salesChannel: booking.salesChannel
        },
        metadata: {
          source,
          changeType,
          rawStatus: status.rawStatus,
          normalizedStatus: status.normalizedStatus,
          rawSalesChannel: mapped.channel.rawChannel
        }
      });
    }

    return {
      action: changeType,
      bookingReference: booking.bookingReference,
      bokunBookingId: booking.bokunBookingId,
      bookingStatus: booking.bookingStatus,
      salesChannel: booking.salesChannel
    };
  };

  const synchronizeCancellation = async ({ mapped, source = "manual", requestId = "", dryRun = false } = {}) => {
    const snapshot = mapped.snapshot || {};
    const existing = await BookingModel.findOne(buildBookingLookupQuery(snapshot));
    if (!existing) {
      return {
        action: "skipped",
        reason: "cancelled_booking_not_imported_locally",
        rawStatus: mapped.status.rawStatus,
        normalizedStatus: mapped.status.normalizedStatus
      };
    }

    if (dryRun) {
      return {
        action: "cancelled",
        dryRun: true,
        bookingReference: existing.bookingReference,
        bokunBookingId: existing.bokunBookingId
      };
    }

    const before = {
      bookingStatus: existing.bookingStatus,
      cancellation: maybeToObject(existing.cancellation),
      bokunStatus: maybeToObject(existing.bokunStatus)
    };
    const patch = buildCancellationPatch({
      mapped,
      existing,
      source,
      requestId,
      nowDate: now()
    });
    Object.assign(existing, patch);
    const booking = typeof existing.save === "function" ? await existing.save() : existing;

    await recordAudit({
      action: "bokun_booking_cancelled_synchronized",
      booking,
      requestId,
      reason: "Bokun reported this booking as cancelled",
      before,
      after: {
        bookingStatus: booking.bookingStatus,
        cancellation: maybeToObject(booking.cancellation),
        bokunStatus: maybeToObject(booking.bokunStatus)
      },
      metadata: {
        source,
        rawStatus: mapped.status.rawStatus,
        normalizedStatus: mapped.status.normalizedStatus
      }
    });

    return {
      action: "cancelled",
      bookingReference: booking.bookingReference,
      bokunBookingId: booking.bokunBookingId,
      bookingStatus: booking.bookingStatus
    };
  };

  const importMappedBooking = async ({ mapped, source = "manual", requestId = "", dryRun = false } = {}) => {
    if (mapped.isImportableConfirmed) {
      return upsertConfirmedBooking({ mapped, source, requestId, dryRun });
    }

    if (mapped.isCancellableSync) {
      return synchronizeCancellation({ mapped, source, requestId, dryRun });
    }

    return {
      action: "skipped",
      reason: mapped.validationErrors.length ? "snapshot_incomplete" : "status_not_importable",
      validationErrors: mapped.validationErrors,
      rawStatus: mapped.status.rawStatus,
      normalizedStatus: mapped.status.normalizedStatus
    };
  };

  const fetchDetailedBooking = async ({ searchItem = null, reference = "", requestId = "" } = {}) => {
    const lookupReference = normalizeToken(reference || resolveBookingLookupReference(searchItem || {}));
    if (!lookupReference) {
      throw new AppError("Bokun booking search result does not include a lookup reference", 422, "BOKUN_LOOKUP_REFERENCE_MISSING");
    }

    return bokun.lookupBooking(lookupReference, requestId);
  };

  const resyncBooking = async ({
    reference,
    searchItem = null,
    source = "manual_resync",
    requestId = "",
    dryRun = false
  } = {}) => {
    const bokunBooking = await fetchDetailedBooking({ searchItem, reference, requestId });
    const mapped = mapBokunBookingForImport({ bokunBooking });
    return importMappedBooking({ mapped, source, requestId, dryRun });
  };

  const createSyncLogStarted = async ({ operation, source, details }) =>
    SyncLogModel.create({
      source: "bokun",
      operation,
      status: "started",
      syncedCount: 0,
      details: {
        source,
        ...details
      },
      startedAt: now()
    });

  const finalizeSyncLog = async ({ syncLog, status, syncedCount, details }) => {
    syncLog.status = status;
    syncLog.syncedCount = syncedCount;
    syncLog.completedAt = now();
    syncLog.details = {
      ...(syncLog.details || {}),
      ...details
    };
    if (typeof syncLog.save === "function") {
      await syncLog.save();
    }
    return syncLog;
  };

  const syncConfirmedBookings = async ({
    pageSize = Number(env.BOKUN_CONFIRMED_BOOKING_IMPORT_BATCH_SIZE || 50),
    maxPages = Number(env.BOKUN_CONFIRMED_BOOKING_IMPORT_MAX_PAGES || 5),
    page = 1,
    bookingStatuses = getDefaultBookingStatuses(),
    dateRangeField = "lastModifiedDateRange",
    fromDate = "",
    toDate = "",
    filters = {},
    source = "manual",
    requestId = "",
    dryRun = false
  } = {}) => {
    if (bulkSyncRunning) {
      return {
        skipped: true,
        reason: "sync_already_running"
      };
    }

    bulkSyncRunning = true;
    const startedAt = now();
    const syncLog = dryRun
      ? null
      : await createSyncLogStarted({
          operation: IMPORT_OPERATION,
          source,
          details: { pageSize, maxPages, page, bookingStatuses, dateRangeField, fromDate, toDate }
        });

    const results = [];
    try {
      const safePageSize = Math.max(1, Math.min(100, Number(pageSize || 50)));
      const safeMaxPages = Math.max(1, Math.min(100, Number(maxPages || 1)));
      let currentPage = Math.max(1, Number(page || 1));
      let totalCount = null;

      for (let pagesRead = 0; pagesRead < safeMaxPages; pagesRead += 1) {
        const pageResult = await bokun.searchBookings({
          page: currentPage,
          pageSize: safePageSize,
          bookingStatuses,
          dateRangeField,
          fromDate,
          toDate,
          filters
        }, requestId);
        const items = ensureArray(pageResult.items);
        totalCount = pageResult.totalCount || totalCount;

        for (const item of items) {
          try {
            const result = await resyncBooking({
              searchItem: item,
              source,
              requestId,
              dryRun
            });
            results.push(result);
          } catch (error) {
            results.push({
              action: "failed",
              reason: error.code || "BOKUN_IMPORT_FAILED",
              message: error.message,
              lookupReference: resolveBookingLookupReference(item)
            });
          }
        }

        if (!items.length || items.length < safePageSize) {
          break;
        }

        if (totalCount !== null && currentPage * safePageSize >= totalCount) {
          break;
        }

        currentPage += 1;
      }

      const summary = summarizeImportResults(results);
      if (syncLog) {
        await finalizeSyncLog({
          syncLog,
          status: summary.failed ? "failed" : "success",
          syncedCount: summary.imported + summary.amended + summary.updated + summary.cancelled,
          details: {
            summary,
            durationMs: now().getTime() - startedAt.getTime(),
            results: results.slice(0, 50)
          }
        });
      }

      return {
        syncLogId: syncLog?._id || null,
        summary,
        results
      };
    } catch (error) {
      if (syncLog) {
        await finalizeSyncLog({
          syncLog,
          status: "failed",
          syncedCount: 0,
          details: {
            error: error.message,
            code: error.code || "BOKUN_IMPORT_FAILED",
            results: results.slice(0, 50)
          }
        });
      }
      throw error;
    } finally {
      bulkSyncRunning = false;
    }
  };

  const manualResync = async ({ reference, source = "manual_resync", requestId = "", dryRun = false } = {}) => {
    const syncLog = dryRun
      ? null
      : await createSyncLogStarted({
          operation: RESYNC_OPERATION,
          source,
          details: { reference }
        });

    try {
      const result = await resyncBooking({ reference, source, requestId, dryRun });
      if (syncLog) {
        await finalizeSyncLog({
          syncLog,
          status: result.action === "failed" ? "failed" : "success",
          syncedCount: ["imported", "amended", "updated", "cancelled"].includes(result.action) ? 1 : 0,
          details: { result }
        });
      }
      return {
        syncLogId: syncLog?._id || null,
        result
      };
    } catch (error) {
      if (syncLog) {
        await finalizeSyncLog({
          syncLog,
          status: "failed",
          syncedCount: 0,
          details: {
            error: error.message,
            code: error.code || "BOKUN_RESYNC_FAILED"
          }
        });
      }
      throw error;
    }
  };

  return {
    syncConfirmedBookings,
    manualResync,
    resyncBooking,
    importMappedBooking,
    upsertConfirmedBooking,
    synchronizeCancellation
  };
};

const service = createBokunConfirmedBookingImportService();

module.exports = {
  ...service,
  createBokunConfirmedBookingImportService,
  __testables: {
    hashSnapshot,
    buildBookingLookupQuery,
    resolveChangeType,
    shouldPreserveExistingFinancials,
    inferExistingSalesChannel,
    summarizeImportResults
  }
};
