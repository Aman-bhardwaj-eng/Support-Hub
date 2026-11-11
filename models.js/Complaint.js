const mongoose = require("mongoose");

const complaintSchema = new mongoose.Schema(
  {
    complaintId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    customer: {
      name: { type: String, required: true, trim: true },
      mobile: { type: String, required: true, trim: true },
      state: { type: String, required: true, trim: true },
      city: { type: String, required: true, trim: true },
      area: { type: String, required: true, trim: true },
      pinCode: { type: String, required: true, trim: true },
    },

    product: {
      type: String,
      required: true,
      enum: [
        "Battery Issue",
        "Solar Panel Issue",
        "Inverter Issue",
        "Charging Issue",
        "Other",
      ],
    },

    model: {
      type: String,
      default: "",
      trim: true,
    },

    serialNumber: {
      type: String,
      default: "",
      trim: true,
    },

    source: { type: String, enum: ["WEB", "WHATSAPP", "ADMIN", "OTHER"], default: "OTHER" },
    erpVerified: { type: Boolean, default: false },
    warrantyState: { type: String, default: "" },
    proofDocuments: [{
      mediaId: { type: String, default: "" },
      mimeType: { type: String, default: "" },
      filename: { type: String, default: "" },
      originalName: { type: String, default: "" },
      receivedAt: { type: Date, default: Date.now }
    }],

    description: {
      type: String,
      required: true,
      trim: true,
    },

    status: {
      type: String,
      enum: [
        "OPEN",
        "ASSIGNED",
        "ENGINEER_ACCEPTED",
        "VISIT_STARTED",
        "RESOLUTION_SUBMITTED",
        "OTP_SENT",
        "COMPLETED",
        "REVISIT_REQUIRED",
      ],
      default: "OPEN",
    },

    engineer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Engineer",
      default: null,
    },

    resolution: {
      remarks: { type: String, default: "" },
      partsUsed: [{ type: String }],
      submittedAt: { type: Date, default: null },
    },

    closureOTP: {
      hash: { type: String, default: null, select: false },
      expiresAt: { type: Date, default: null },
      attempts: { type: Number, default: 0 },
    },

    completedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Complaint", complaintSchema);
