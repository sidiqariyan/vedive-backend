const mongoose = require('mongoose');

const emailTrackingSchema = new mongoose.Schema({
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    required: true
  },
  recipientEmail: {
    type: String,
    required: true
  },
  recipientName: {
    type: String,
    default: null
  },
  trackingId: {
    type: String,
    unique: true,
    required: true
  },
  // Email sending status
  sent: {
    type: Boolean,
    default: false
  },
  sentAt: {
    type: Date,
    default: null
  },
  messageId: {
    type: String, // Email message ID from nodemailer
    default: null
  },
  
  // Email opening tracking  
  opened: {
    type: Boolean,
    default: false
  },
  openedAt: {
    type: Date,
    default: null
  },
  lastOpenedAt: {
    type: Date,
    default: null
  },
  openCount: {
    type: Number,
    default: 0
  },
  
  // Client information
  userAgent: {
    type: String,
    default: null
  },
  ipAddress: {
    type: String,
    default: null
  },
  
  // Error handling
  error: {
    type: String,
    default: null
  },
  failedAt: {
    type: Date,
    default: null
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt field before saving
emailTrackingSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Index for better query performance
emailTrackingSchema.index({ campaignId: 1 });
emailTrackingSchema.index({ trackingId: 1 });
emailTrackingSchema.index({ recipientEmail: 1 });
emailTrackingSchema.index({ opened: 1 });

// Virtual for tracking status
emailTrackingSchema.virtual('status').get(function() {
  if (this.error) return 'failed';
  if (!this.sent) return 'pending';
  if (this.opened) return 'opened';
  return 'sent';
});

// Method to mark as opened
emailTrackingSchema.methods.markAsOpened = function(userAgent, ipAddress) {
  if (!this.opened) {
    this.opened = true;
    this.openedAt = new Date();
  }
  this.openCount += 1;
  this.lastOpenedAt = new Date();
  this.userAgent = userAgent || this.userAgent;
  this.ipAddress = ipAddress || this.ipAddress;
  return this.save();
};

// Method to mark as sent
emailTrackingSchema.methods.markAsSent = function(messageId) {
  this.sent = true;
  this.sentAt = new Date();
  this.messageId = messageId;
  return this.save();
};

// Method to mark as failed
emailTrackingSchema.methods.markAsFailed = function(error) {
  this.sent = false;
  this.error = error;
  this.failedAt = new Date();
  return this.save();
};

// Static method to get campaign analytics
emailTrackingSchema.statics.getCampaignAnalytics = function(campaignId) {
  return this.aggregate([
    { $match: { campaignId: mongoose.Types.ObjectId(campaignId) } },
    {
      $group: {
        _id: null,
        totalEmails: { $sum: 1 },
        sentEmails: { $sum: { $cond: ['$sent', 1, 0] } },
        openedEmails: { $sum: { $cond: ['$opened', 1, 0] } },
        failedEmails: { $sum: { $cond: ['$error', 1, 0] } },
        totalOpens: { $sum: '$openCount' },
        avgOpensPerEmail: { $avg: '$openCount' }
      }
    }
  ]);
};

module.exports = mongoose.model('EmailTracking', emailTrackingSchema);