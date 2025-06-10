const mongoose = require("mongoose");

const recipientSchema = new mongoose.Schema({
  email: { type: String, required: true },
  name: { type: String },
  trackingToken: { type: String, required: true }
});

const campaignSchema = new mongoose.Schema(
  {
    userId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true, 
      index: true 
    },
    campaignName: { 
      type: String, 
      required: true, 
      trim: true 
    },
    toolType: { 
      type: String, 
      required: true, 
      enum: [
        "gmail-sender", 
        "number-scraper", 
        "mail-sender", 
        "whatsapp-bulk-sender", 
        "email-scraper"
      ],
      index: true 
    },
    smtpHost: { type: String, default: "" },
    smtpPort: { type: Number, default: 587 },
    smtpUsername: { type: String, default: "" },
    smtpPassword: { type: String, select: false, default: "" },
    fromEmail: { type: String, default: "" },
    emailSubject: { type: String, default: "" },
    recipients: [recipientSchema],
    status: { 
      type: String, 
      enum: ["pending", "sending", "in-progress", "completed", "failed"], 
      default: "pending" 
    },
  },
  { timestamps: true }
);

campaignSchema.index({ 'recipients.trackingToken': 1 });

module.exports = mongoose.models.Campaign || mongoose.model("Campaign", campaignSchema);
