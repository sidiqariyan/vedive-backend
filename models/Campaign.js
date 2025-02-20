const mongoose = require('mongoose');
const campaignSchema = new mongoose.Schema({
  campaignName: { type: String, required: true },
  toolType: { type: String, required: true, enum: ["gmail-sender", "number-scraper", "whatsapp-bulk-sender"] },  // Added whatsapp-bulk-sender
  smtpHost: { type: String },
  smtpPort: { type: Number },
  smtpUsername: { type: String },
  smtpPassword: { type: String },
  fromEmail: { type: String },
  emailSubject: { type: String },
  recipients: { type: [String] },
  query: { type: String },
  scrapedNumbers: { type: [String] },
  messageContent: { type: String },  // Added message content field
  createdAt: { type: Date, default: Date.now },
});
