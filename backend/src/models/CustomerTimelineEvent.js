const mongoose = require("mongoose");
const {
  CRM_COMMUNICATION_CHANNEL,
  CRM_COMMUNICATION_DIRECTION,
  CRM_COMMUNICATION_STATUS,
  CUSTOMER_TIMELINE_EVENT_TYPE
} = require("../crm/constants");

const communicationSchema = new mongoose.Schema(
  {
    channel: {
      type: String,
      enum: Object.values(CRM_COMMUNICATION_CHANNEL),
      required: true,
      index: true
    },
    direction: {
      type: String,
      enum: Object.values(CRM_COMMUNICATION_DIRECTION),
      required: true
    },
    status: {
      type: String,
      enum: Object.values(CRM_COMMUNICATION_STATUS),
      default: CRM_COMMUNICATION_STATUS.MANUAL_LOGGED
    },
    subject: { type: String, default: "", trim: true, maxlength: 240 },
    bodyPreview: { type: String, default: "", trim: true, maxlength: 1000 }
  },
  { _id: false }
);

const customerTimelineEventSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
    eventType: {
      type: String,
      enum: Object.values(CUSTOMER_TIMELINE_EVENT_TYPE),
      required: true,
      index: true
    },
    sourceModule: { type: String, default: "CRM", trim: true, index: true },
    sourceEntityType: { type: String, default: "", trim: true },
    sourceEntityId: { type: String, default: "", trim: true },
    reference: { type: String, default: "", trim: true, index: true },
    summary: { type: String, required: true, trim: true, maxlength: 500 },
    occurredAt: { type: Date, default: Date.now, index: true },
    actor: {
      id: { type: String, default: "" },
      role: { type: String, default: "" },
      email: { type: String, default: "" }
    },
    metadata: mongoose.Schema.Types.Mixed,
    communication: { type: communicationSchema, default: undefined },
    sensitive: { type: Boolean, default: false }
  },
  { timestamps: true }
);

customerTimelineEventSchema.index({ customerId: 1, occurredAt: -1 });
customerTimelineEventSchema.index({ sourceEntityType: 1, sourceEntityId: 1, occurredAt: -1 });
customerTimelineEventSchema.index({ customerId: 1, "communication.channel": 1, occurredAt: -1 });

module.exports = mongoose.model("CustomerTimelineEvent", customerTimelineEventSchema);
