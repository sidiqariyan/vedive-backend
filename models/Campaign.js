const mongoose = require('mongoose');

// Define the campaign schema
const campaignSchema = new mongoose.Schema({
  campaignName: {
    type: String,
    required: true,
  },
  smtpHost: {
    type: String,
    required: true,
  },
  smtpPort: {
    type: Number,
    required: true,
  },
  smtpUsername: {
    type: String,
    required: true,
  },
  smtpPassword: {
    type: String,
    required: true,
  },
  fromEmail: {
    type: String,
    required: true,
  },
  emailSubject: {
    type: String,
    required: true,
  },
  recipients: {
    type: [String],
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Export the Campaign model
module.exports = mongoose.models.Campaign || mongoose.model('Campaign', campaignSchema);