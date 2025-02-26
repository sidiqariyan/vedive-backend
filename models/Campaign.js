const mongoose = require("mongoose");

const campaignSchema = new mongoose.Schema(
  {
    userId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true, 
      index: true // Improve query performance for user-specific lookups
    },
    campaignName: { 
      type: String, 
      required: true, 
      trim: true // Remove leading/trailing whitespace
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
      index: true // Useful for filtering by tool type if needed
    },
    smtpHost: { 
      type: String, 
      default: "" 
    },
    smtpPort: { 
      type: Number, 
      default: 587 // Default SMTP port
    },
    smtpUsername: { 
      type: String, 
      default: "" 
    },
    smtpPassword: { 
      type: String, 
      select: false, // Exclude from queries by default
      default: "" 
    },
    fromEmail: { 
      type: String,
      required: function() { 
        // Required only for email-based senders
        return this.toolType === "mail-sender" || this.toolType === "gmail-sender";
      },
      default: ""
    },
    emailSubject: { 
      type: String, 
      default: "" 
    },
    recipients: { 
      type: [String], 
      default: [],
      validate: {
        validator: function (emails) {
          // Only validate emails if toolType is email-related
          if (this.toolType === "mail-sender" || this.toolType === "gmail-sender") {
            return emails.every((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
          }
          return true; // No validation for non-email tools (e.g., WhatsApp)
        },
        message: "Invalid email address found in recipients",
      },
    },
    query: { 
      type: String, 
      default: "" // For scraper tools
    },
    scrapedNumbers: { 
      type: [String], 
      default: [],
      validate: {
        validator: function (numbers) {
          // Validate phone numbers only for WhatsApp
          if (this.toolType === "whatsapp-bulk-sender") {
            return numbers.every((num) => /^\+?[1-9]\d{1,14}$/.test(num)); // Basic E.164 format
          }
          return true;
        },
        message: "Invalid phone number found in scrapedNumbers",
      },
    },
    messageContent: { 
      type: String, 
      default: "" 
    },
    status: { 
      type: String, 
      enum: ["pending", "in-progress", "completed", "failed"], 
      default: "pending" // Track campaign execution status
    },
  },
  { timestamps: true } // Automatically adds createdAt & updatedAt
);

// Ensure the model is only created once
module.exports = mongoose.models.Campaign || mongoose.model("Campaign", campaignSchema);