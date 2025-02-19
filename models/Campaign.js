const mongoose = require("mongoose");

const campaignSchema = new mongoose.Schema({
  campaignName: { type: String, required: true },
  toolType: { type: String, required: true, enum: ["gmail-sender", "number-scraper"] },
  smtpHost: { type: String },
  smtpPort: { type: Number },
  smtpUsername: { type: String },
  smtpPassword: { type: String },
  fromEmail: { type: String },
  emailSubject: { type: String },
  recipients: { type: [String] },
  query: { type: String },
  scrapedNumbers: { type: [String] },
  createdAt: { type: Date, default: Date.now },
});

// Ensure the model is not recompiled if already defined
const Campaign = mongoose.models.Campaign || mongoose.model("Campaign", campaignSchema);
module.exports = Campaign;
