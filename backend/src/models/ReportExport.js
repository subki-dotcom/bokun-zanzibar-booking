const mongoose = require("mongoose");
const { REPORT_EXPORT_FORMAT, REPORT_TYPE } = require("../reportCenter/constants");

const reportExportSchema = new mongoose.Schema(
  {
    reportType: {
      type: String,
      enum: Object.values(REPORT_TYPE),
      required: true,
      index: true
    },
    format: {
      type: String,
      enum: Object.values(REPORT_EXPORT_FORMAT),
      required: true,
      index: true
    },
    filters: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ["completed", "failed"],
      default: "completed",
      index: true
    },
    generatedBy: { type: String, default: "", index: true },
    generatedAt: { type: Date, default: Date.now, index: true },
    requestId: { type: String, default: "", index: true },
    rowCount: { type: Number, default: 0 },
    contentType: { type: String, default: "" },
    bytes: { type: Number, default: 0 },
    fileReference: { type: String, default: "response_only" },
    retained: { type: Boolean, default: false },
    error: {
      code: { type: String, default: "" },
      message: { type: String, default: "" }
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

reportExportSchema.index({ generatedAt: -1 });
reportExportSchema.index({ reportType: 1, generatedAt: -1 });
reportExportSchema.index({ format: 1, generatedAt: -1 });
reportExportSchema.index({ status: 1, generatedAt: -1 });

module.exports = mongoose.model("ReportExport", reportExportSchema);
