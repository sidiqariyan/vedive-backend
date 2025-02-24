const mongoose = require("mongoose");

const campaignSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // Link to the user
    campaignName: { type: String, required: true },
    toolType: { 
      type: String, 
      required: true, 
      enum: ["gmail-sender", "number-scraper", "mail-sender", "whatsapp-bulk-sender", "email-scraper"] 
    },
    smtpHost: { type: String, default: "" },
    smtpPort: { type: Number, default: 587 }, // Default SMTP port
    smtpUsername: { type: String, default: "" },
    smtpPassword: { type: String, select: false }, // Exclude password from queries
    fromEmail: { type: String, default: "" },
    emailSubject: { type: String, default: "" },
    recipients: { 
      type: [String], 
      validate: {
        validator: function (emails) {
          return emails.every(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
        },
        message: "Invalid email address found in recipients",
      },
    },
    query: { type: String, default: "" },
    scrapedNumbers: { type: [String], default: [] },
    messageContent: { type: String, default: "" },
  },
  { timestamps: true } // Automatically adds createdAt & updatedAt
);

const Campaign = mongoose.models.Campaign || mongoose.model("Campaign", campaignSchema);
module.exports = Campaign;
