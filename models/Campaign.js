const mongoose = require("mongoose");

// Define the campaign schema
const campaignSchema = new mongoose.Schema({
  campaignName: { type: String, required: true },
  toolType: { type: String, required: true, enum: ["gmail-sender", "number-scraper", "whatsapp-bulk-sender"] },
  smtpHost: { type: String },
  smtpPort: { type: Number },
  smtpUsername: { type: String },
  smtpPassword: { type: String },
  fromEmail: { type: String },
  emailSubject: { type: String },
  recipients: { type: [String] },
  query: { type: String },
  scrapedNumbers: { type: [String] },
  messageContent: { type: String }, // For WhatsApp messages
  createdAt: { type: Date, default: Date.now },
});

// Ensure the model is not recompiled if already defined
const Campaign = mongoose.models.Campaign || mongoose.model("Campaign", campaignSchema);
module.exports = Campaign;