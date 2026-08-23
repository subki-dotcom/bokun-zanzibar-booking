process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/crm-b2b-partner-core-test";
process.env.JWT_SECRET ||= "crm-b2b-partner-core-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CRM_B2B_COMMISSION_MODEL,
  CRM_B2B_PARTNER_STATUS,
  CRM_B2B_PARTNER_TYPE
} = require("../src/crm/constants");
const { createCrmB2BPartnerService } = require("../src/services/crmB2BPartners");

const clone = (value) => JSON.parse(JSON.stringify(value));
const makeId = (index) => `64b20000000000000000${String(index).padStart(4, "0")}`.slice(0, 24);

const valueAtPath = (row, key) =>
  key.split(".").reduce((current, part) => (current === undefined || current === null ? undefined : current[part]), row);

const matches = (row, query = {}) => {
  if (query.$or) return query.$or.some((clause) => matches(row, clause));
  return Object.entries(query).every(([key, value]) => {
    if (key === "externalReferences" && value.$elemMatch) {
      return (row.externalReferences || []).some((reference) => matches(reference, value.$elemMatch));
    }
    if (value && typeof value === "object" && value.$in) {
      return value.$in.includes(valueAtPath(row, key));
    }
    return String(valueAtPath(row, key) || "") === String(value || "");
  });
};

const queryResult = (value) => ({
  sort() {
    return this;
  },
  skip() {
    return this;
  },
  limit() {
    return this;
  },
  async lean() {
    return clone(value);
  }
});

const wrapDoc = (row, state) => ({
  ...clone(row),
  toObject() {
    const { save, toObject, ...plain } = this;
    return clone(plain);
  },
  async save() {
    const index = state.partners.findIndex((item) => String(item._id) === String(this._id));
    const plain = this.toObject();
    if (index >= 0) state.partners[index] = plain;
    else state.partners.push(plain);
    return this;
  }
});

const createHarness = () => {
  const state = {
    partners: [],
    audits: []
  };
  const B2BPartnerModel = {
    findOne: (query) => queryResult(state.partners.find((partner) => matches(partner, query)) || null),
    find: (query) => queryResult(state.partners.filter((partner) => matches(partner, query))),
    findById: (id) => {
      const found = state.partners.find((partner) => String(partner._id) === String(id));
      return found ? wrapDoc(found, state) : null;
    },
    countDocuments: async (query) => state.partners.filter((partner) => matches(partner, query)).length,
    aggregate: async (pipeline = []) => {
      const groupKey = pipeline[0]?.$group?._id?.replace("$", "");
      if (!groupKey) return [];
      const counts = state.partners.reduce((acc, partner) => {
        const key = valueAtPath(partner, groupKey) || "";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      return Object.entries(counts).map(([_id, count]) => ({ _id, count }));
    },
    create: async (payload) => {
      const row = {
        _id: makeId(state.partners.length + 1),
        ...clone(payload),
        createdAt: "2026-08-23T08:00:00.000Z",
        updatedAt: "2026-08-23T08:00:00.000Z"
      };
      state.partners.push(row);
      return wrapDoc(row, state);
    }
  };
  const AuditLogModel = {
    create: async (payload) => {
      state.audits.push(clone(payload));
      return payload;
    }
  };
  const service = createCrmB2BPartnerService({
    B2BPartnerModel,
    AuditLogModel,
    now: () => new Date("2026-08-23T08:00:00.000Z")
  });

  return { service, state };
};

test("creates a CRM B2B partner and prevents duplicate partner records without accounting postings", async () => {
  const { service, state } = createHarness();
  const created = await service.createB2BPartner({
    payload: {
      partnerType: CRM_B2B_PARTNER_TYPE.TRAVEL_AGENT,
      companyName: "Spice Travel",
      contactPerson: "Asha Partner",
      email: "INFO@SPICETRAVEL.EXAMPLE",
      phone: "+255 700 111 222",
      country: "Tanzania",
      commissionModel: CRM_B2B_COMMISSION_MODEL.PERCENTAGE,
      commissionRate: 12.5,
      paymentTerms: "Invoice monthly"
    },
    auth: { id: "admin-1", role: "admin", email: "admin@example.test" },
    requestId: "b2b-create"
  });
  const duplicate = await service.createB2BPartner({
    payload: {
      companyName: "Spice Travel",
      contactPerson: "Another Contact",
      email: "info@spicetravel.example",
      country: "Tanzania"
    },
    requestId: "b2b-duplicate"
  });

  assert.equal(created.action, "created");
  assert.equal(created.partner.emailNormalized, "info@spicetravel.example");
  assert.equal(created.partner.phoneNormalized, "+255700111222");
  assert.equal(created.partner.status, CRM_B2B_PARTNER_STATUS.PROSPECT);
  assert.equal(created.accountingIntegration.postsLedgerEntries, false);
  assert.equal(duplicate.action, "existing");
  assert.equal(state.partners.length, 1);
  assert.ok(state.audits.some((audit) => audit.action === "crm_b2b_partner_created"));
  assert.ok(state.audits.some((audit) => audit.action === "crm_b2b_partner_duplicate_prevented"));
});

test("updates B2B partner pipeline status with audit history and no ledger side effects", async () => {
  const { service, state } = createHarness();
  const created = await service.createB2BPartner({
    payload: {
      partnerType: CRM_B2B_PARTNER_TYPE.HOTEL,
      companyName: "Stone Town Hotel",
      contactPerson: "Hotel Manager",
      email: "manager@stonetown.example",
      country: "Tanzania"
    },
    auth: { id: "admin-1", role: "admin" }
  });

  const updated = await service.updateB2BPartner({
    partnerId: created.partner.id,
    payload: {
      status: CRM_B2B_PARTNER_STATUS.ACTIVE_PARTNER,
      paymentTerms: "Net 14"
    },
    auth: { id: "admin-2", role: "admin", email: "ops@example.test" },
    requestId: "b2b-status"
  });
  const metrics = await service.getB2BPartnerMetrics();

  assert.equal(updated.action, "updated");
  assert.equal(updated.partner.status, CRM_B2B_PARTNER_STATUS.ACTIVE_PARTNER);
  assert.equal(updated.partner.paymentTerms, "Net 14");
  assert.equal(updated.accountingIntegration.postsLedgerEntries, false);
  assert.equal(metrics.activeB2BPartnerCount, 1);
  const statusAudit = state.audits.find((audit) => audit.action === "crm_b2b_partner_status_changed");
  assert.ok(statusAudit);
  assert.equal(statusAudit.metadata.accountingIntegration.postsLedgerEntries, false);
  assert.equal(statusAudit.metadata.previousStatus, CRM_B2B_PARTNER_STATUS.PROSPECT);
  assert.equal(statusAudit.metadata.status, CRM_B2B_PARTNER_STATUS.ACTIVE_PARTNER);
});

test("percentage commission requires an explicit positive commission rate", async () => {
  const { service } = createHarness();

  await assert.rejects(
    () =>
      service.createB2BPartner({
        payload: {
          companyName: "No Rate Agent",
          contactPerson: "Agent Contact",
          commissionModel: CRM_B2B_COMMISSION_MODEL.PERCENTAGE
        }
      }),
    /positive commission rate/
  );
});
