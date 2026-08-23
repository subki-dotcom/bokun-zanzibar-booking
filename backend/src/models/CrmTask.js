const mongoose = require("mongoose");
const {
  CRM_PRIORITY,
  CRM_TASK_RELATED_ENTITY_TYPE,
  CRM_TASK_STATUS
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

const crmTaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    relatedEntityType: {
      type: String,
      enum: Object.values(CRM_TASK_RELATED_ENTITY_TYPE),
      default: CRM_TASK_RELATED_ENTITY_TYPE.OTHER,
      index: true
    },
    relatedEntityId: { type: String, default: "", trim: true, index: true },
    assignedTo: { type: actorSnapshotSchema, default: () => ({}) },
    dueDate: { type: Date, default: null, index: true },
    priority: {
      type: String,
      enum: Object.values(CRM_PRIORITY),
      default: CRM_PRIORITY.NORMAL,
      index: true
    },
    status: {
      type: String,
      enum: Object.values(CRM_TASK_STATUS),
      default: CRM_TASK_STATUS.TODO,
      index: true
    },
    completedAt: { type: Date, default: null },
    outcome: { type: String, default: "", trim: true },
    createdBy: { type: actorSnapshotSchema, default: () => ({}) },
    updatedBy: { type: actorSnapshotSchema, default: () => ({}) }
  },
  { timestamps: true }
);

crmTaskSchema.index({ status: 1, dueDate: 1 });
crmTaskSchema.index({ "assignedTo.id": 1, status: 1, dueDate: 1 });
crmTaskSchema.index({ relatedEntityType: 1, relatedEntityId: 1, status: 1 });

module.exports = mongoose.model("CrmTask", crmTaskSchema);
