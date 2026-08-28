process.env.NODE_ENV = "test";
process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/crm-imports-core-test";
process.env.JWT_SECRET ||= "crm-imports-core-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCrmImportService } = require("../src/services/crmImports");

const getPath = (row = {}, path = "") =>
  path.split(".").reduce((current, part) => (current === null || current === undefined ? undefined : current[part]), row);

const matchesQuery = (query = {}, row = {}) => {
  if (query.$or) return query.$or.some((clause) => matchesQuery(clause, row));

  return Object.entries(query).every(([key, expected]) => {
    const actual = getPath(row, key);
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if (expected.$nin) return !expected.$nin.includes(actual);
      if (expected.$elemMatch) {
        const items = Array.isArray(actual) ? actual : [];
        return items.some((item) => matchesQuery(expected.$elemMatch, item));
      }
    }
    return String(actual || "") === String(expected || "");
  });
};

const makeModel = (rows = []) => ({
  findOne: (query) => ({
    lean: async () => rows.find((row) => matchesQuery(query, row)) || null
  })
});

const makeAuditLog = () => {
  const writes = [];
  return {
    writes,
    create: async (payload) => {
      writes.push(payload);
      return payload;
    }
  };
};

const auth = {
  id: "admin-1",
  role: "admin",
  email: "admin@example.test"
};

test("CRM import dry-run previews creates without writing and does not block on name-only customer matches", async () => {
  let customerWrites = 0;
  const auditLog = makeAuditLog();
  const service = createCrmImportService({
    AuditLogModel: auditLog,
    CustomerModel: makeModel([
      {
        _id: "existing-customer",
        firstName: "Asha",
        lastName: "Traveler",
        emailNormalized: "different@example.test"
      }
    ]),
    customerService: {
      createCustomer: async () => {
        customerWrites += 1;
        return { action: "created", customer: { id: "new-customer" } };
      }
    },
    now: () => new Date("2026-08-28T08:00:00.000Z")
  });

  const result = await service.runCrmImport({
    importType: "CUSTOMERS",
    dryRun: true,
    records: [
      {
        firstName: "Asha",
        lastName: "Traveler",
        email: "asha@example.test"
      }
    ],
    auth,
    requestId: "req-1"
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.validation.createCount, 1);
  assert.equal(result.plan[0].status, "CREATE");
  assert.equal(customerWrites, 0);
  assert.equal(auditLog.writes.length, 0);
  assert.equal(result.verification.noNameOnlyMerge, true);
});

test("CRM import detects stable customer duplicates, review-only matches, and invalid rows", async () => {
  const service = createCrmImportService({
    CustomerModel: makeModel([
      {
        _id: "email-match",
        crmCustomerNumber: "CUS-EMAIL",
        emailNormalized: "known@example.test"
      },
      {
        _id: "phone-match",
        crmCustomerNumber: "CUS-PHONE",
        phoneNormalized: "+255711000000"
      }
    ]),
    now: () => new Date("2026-08-28T08:00:00.000Z")
  });

  const result = await service.runCrmImport({
    importType: "CUSTOMERS",
    dryRun: true,
    records: [
      { firstName: "Known", lastName: "Customer", email: "known@example.test" },
      { firstName: "Phone", lastName: "Match", email: "phone@example.test", phone: "+255 711 000 000" },
      { firstName: "No", lastName: "Email" }
    ],
    auth
  });

  assert.equal(result.validation.skipExistingCount, 1);
  assert.equal(result.validation.reviewRequiredCount, 1);
  assert.equal(result.validation.invalidCount, 1);
  assert.equal(result.plan[0].status, "SKIP_EXISTING");
  assert.equal(result.plan[1].status, "REVIEW_REQUIRED");
  assert.equal(result.plan[2].status, "INVALID");
});

test("CRM import apply requires an evidence note before writes", async () => {
  let leadWrites = 0;
  const service = createCrmImportService({
    LeadModel: makeModel([]),
    leadService: {
      createLead: async () => {
        leadWrites += 1;
        return { action: "created", lead: { id: "lead-1", leadReference: "LED-1" } };
      }
    }
  });

  await assert.rejects(
    () =>
      service.runCrmImport({
        importType: "HISTORICAL_LEADS",
        dryRun: false,
        records: [{ firstName: "Asha", lastName: "Traveler", email: "asha@example.test" }],
        evidenceNote: "",
        auth
      }),
    (error) => error.code === "CRM_IMPORT_EVIDENCE_NOTE_REQUIRED"
  );
  assert.equal(leadWrites, 0);
});

test("CRM import apply blocks review-required rows before any service write", async () => {
  let b2bWrites = 0;
  const auditLog = makeAuditLog();
  const service = createCrmImportService({
    AuditLogModel: auditLog,
    B2BPartnerModel: makeModel([
      {
        _id: "partner-1",
        partnerNumber: "B2B-1",
        companyName: "Spice Travel",
        companyNameNormalized: "spice travel"
      }
    ]),
    b2bPartnerService: {
      createB2BPartner: async () => {
        b2bWrites += 1;
        return { action: "created", partner: { id: "b2b-2", partnerNumber: "B2B-2" } };
      }
    }
  });

  await assert.rejects(
    () =>
      service.runCrmImport({
        importType: "B2B_CONTACTS",
        dryRun: false,
        evidenceNote: "Reviewed import source file.",
        records: [
          {
            companyName: "Spice Travel",
            contactPerson: "Asha Partner",
            email: "new-agent@example.test"
          }
        ],
        auth
      }),
    (error) => error.code === "CRM_IMPORT_VALIDATION_FAILED"
  );

  assert.equal(b2bWrites, 0);
  assert.equal(auditLog.writes.length, 0);
});

test("CRM import apply reuses existing lead service and records an import audit", async () => {
  const auditLog = makeAuditLog();
  const createdPayloads = [];
  const service = createCrmImportService({
    AuditLogModel: auditLog,
    LeadModel: makeModel([]),
    leadService: {
      createLead: async ({ payload }) => {
        createdPayloads.push(payload);
        return { action: "created", lead: { id: "lead-1", leadReference: "LED-1" } };
      }
    },
    now: () => new Date("2026-08-28T08:00:00.000Z")
  });

  const result = await service.runCrmImport({
    importType: "HISTORICAL_LEADS",
    dryRun: false,
    evidenceNote: "Historical CSV reviewed by sales admin.",
    source: "legacy_csv",
    records: [
      {
        firstName: "Asha",
        lastName: "Traveler",
        email: "asha@example.test",
        sourceRecordId: "legacy-001"
      }
    ],
    auth,
    requestId: "req-apply"
  });

  assert.equal(result.action, "applied");
  assert.equal(result.applied.createdCount, 1);
  assert.equal(createdPayloads.length, 1);
  assert.equal(createdPayloads[0].source, "OTHER");
  assert.equal(createdPayloads[0].externalReferences[0].provider, "legacy_csv");
  assert.equal(auditLog.writes.length, 1);
  assert.equal(auditLog.writes[0].action, "crm_import_applied");
  assert.equal(auditLog.writes[0].metadata.noNameOnlyMerge, true);
});
