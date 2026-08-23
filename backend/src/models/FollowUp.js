const mongoose = require("mongoose");
const {
  CRM_FOLLOW_UP_STATUS,
  CRM_FOLLOW_UP_TYPE,
  CRM_PRIORITY
} = require("../crm/constants");

const actorSnapshotSchema = new mongoose.Schema(
  {
    id: { type: String, default: "" },
    role: { type: String, default: "" },
    email: { type: String, default: "" },
    name: { type: String, default: "" }
  },
  { _id: false }
);

const followUpSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null, index: true },
    opportunityId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesOpportunity", default: null, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null, index: true },
    type: {
      type: String,
      enum: Object.values(CRM_FOLLOW_UP_TYPE),
      default: CRM_FOLLOW_UP_TYPE.CALL,
      index: true
    },
    dueAt: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: Object.values(CRM_FOLLOW_UP_STATUS),
      default: CRM_FOLLOW_UP_STATUS.PENDING,
      index: true
    },
    assignedTo: { type: actorSnapshotSchema, default: () => ({}) },
    priority: {
      type: String,
      enum: Object.values(CRM_PRIORITY),
      default: CRM_PRIORITY.NORMAL,
      index: true
    },
    notes: { type: String, default: "", trim: true },
    completedAt: { type: Date, default: null },
    outcome: { type: String, default: "", trim: true },
    createdBy: { type: actorSnapshotSchema, default: () => ({}) },
    updatedBy: { type: actorSnapshotSchema, default: () => ({}) }
  },
  { timestamps: true }
);

followUpSchema.index({ status: 1, dueAt: 1 });
followUpSchema.index({ "assignedTo.id": 1, status: 1, dueAt: 1 });
followUpSchema.index({ customerId: 1, status: 1, dueAt: 1 });
followUpSchema.index({ leadId: 1, status: 1, dueAt: 1 });
followUpSchema.index({ opportunityId: 1, status: 1, dueAt: 1 });

module.exports = mongoose.model("FollowUp", followUpSchema);
