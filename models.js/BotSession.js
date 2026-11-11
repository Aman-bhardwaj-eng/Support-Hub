const mongoose = require("mongoose");

const botSessionSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true, index: true, trim: true },
    step: { type: String, default: "MENU", trim: true },
    data: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    lastMessageId: { type: String, default: "", trim: true },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }
  },
  { timestamps: true, minimize: false }
);

// Expire inactive conversation records after 30 days. TTL cleanup is asynchronous in MongoDB.
botSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("BotSession", botSessionSchema);
