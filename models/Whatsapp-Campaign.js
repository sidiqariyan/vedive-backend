const mongoose = require("mongoose");

// Campaign Schema
const campaignSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  senderPhoneNumber: { type: String, required: true }, // Track which phone sent this campaign
  campaignName: { type: String, required: true },
  toolType: { type: String, required: true },
  messageContent: { type: String, required: true },
  recipients: [{
    phoneNumber: String,
    status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
    trackingToken: String
  }],
  status: { type: String, enum: ['draft', 'in-progress', 'completed', 'failed'], default: 'draft' },
  totalSent: { type: Number, default: 0 },
  totalFailed: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// WhatsApp Analytics Schema - FIXED
const whatsappAnalyticsSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
  senderPhoneNumber: { type: String, required: true }, // Track sender
  messageId: { type: String, sparse: true }, // Allow null values, made sparse
  phoneNumber: { type: String, required: true },
  messageContent: { type: String, required: true },
  status: { type: String, enum: ['sent', 'delivered', 'read', 'failed'], default: 'sent' },
  sentAt: { type: Date, default: Date.now },
  deliveredAt: Date,
  readAt: Date,
  // Fixed: Use trackingToken (consistent with your recipients schema) instead of trackingId
  trackingToken: { type: String, sparse: true }, // Allow null, sparse index
  // Add error message field for failed messages
  errorMessage: String,
  // Add retry count for failed messages
  retryCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Campaign Analytics Schema
const campaignAnalyticsSchema = new mongoose.Schema({
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
  totalMessages: { type: Number, default: 0 },
  sentMessages: { type: Number, default: 0 },
  deliveredMessages: { type: Number, default: 0 },
  readMessages: { type: Number, default: 0 },
  failedMessages: { type: Number, default: 0 },
  deliveryRate: { type: Number, default: 0 },
  openRate: { type: Number, default: 0 },
  lastUpdated: { type: Date, default: Date.now }
});

// WhatsApp Account Schema
const whatsappAccountSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  phoneNumber: { type: String, required: true },
  isAuthenticated: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  lastConnected: Date,
  lastDisconnected: Date,
  sessionData: String, // Encrypted session data
  campaignCount: { type: Number, default: 0 },
  totalMessagesSent: { type: Number, default: 0 }, // Track total messages sent
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// FIXED INDEXES - Prevent duplicate key errors
whatsappAccountSchema.index({ userId: 1, phoneNumber: 1 }, { unique: true });

// Create compound index for analytics to prevent duplicates
whatsappAnalyticsSchema.index({ 
  userId: 1, 
  campaignId: 1, 
  phoneNumber: 1, 
  messageId: 1 
}, { 
  unique: true, 
  sparse: true, // Allow null messageId values
  name: "unique_analytics_record"
});

// Create index for efficient queries
whatsappAnalyticsSchema.index({ campaignId: 1, phoneNumber: 1 });
whatsappAnalyticsSchema.index({ senderPhoneNumber: 1, status: 1 });

// Create index for tracking token if needed
whatsappAnalyticsSchema.index({ trackingToken: 1 }, { sparse: true });

// Campaign indexes
campaignSchema.index({ userId: 1, senderPhoneNumber: 1 });
campaignSchema.index({ userId: 1, createdAt: -1 });

// Campaign Analytics index
campaignAnalyticsSchema.index({ campaignId: 1 }, { unique: true });

// Pre-save middleware to update timestamps
whatsappAnalyticsSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

campaignSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

whatsappAccountSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Method to update campaign analytics
campaignAnalyticsSchema.methods.updateAnalytics = async function() {
  try {
    const WhatsAppAnalytics = mongoose.models.WhatsAppAnalytics || mongoose.model('WhatsAppAnalytics', whatsappAnalyticsSchema);
    
    const analytics = await WhatsAppAnalytics.find({ campaignId: this.campaignId });
    
    this.totalMessages = analytics.length;
    this.sentMessages = analytics.filter(a => a.status !== 'failed').length;
    this.deliveredMessages = analytics.filter(a => a.status === 'delivered' || a.status === 'read').length;
    this.readMessages = analytics.filter(a => a.status === 'read').length;
    this.failedMessages = analytics.filter(a => a.status === 'failed').length;
    this.deliveryRate = this.totalMessages > 0 ? (this.deliveredMessages / this.totalMessages) * 100 : 0;
    this.openRate = this.totalMessages > 0 ? (this.readMessages / this.totalMessages) * 100 : 0;
    this.lastUpdated = new Date();
    
    await this.save();
    
    console.log(`📊 Campaign analytics updated: ${this.deliveredMessages}/${this.totalMessages} delivered (${this.deliveryRate.toFixed(1)}%)`);
  } catch (error) {
    console.error('Error updating campaign analytics:', error);
  }
};

// Static method to get campaign summary
campaignSchema.statics.getCampaignSummary = async function(userId, phoneNumber = null) {
  const query = { userId };
  if (phoneNumber) query.senderPhoneNumber = phoneNumber;
  
  const campaigns = await this.find(query).sort({ createdAt: -1 });
  
  return {
    totalCampaigns: campaigns.length,
    activeCampaigns: campaigns.filter(c => c.status === 'in-progress').length,
    completedCampaigns: campaigns.filter(c => c.status === 'completed').length,
    failedCampaigns: campaigns.filter(c => c.status === 'failed').length,
    totalMessagesSent: campaigns.reduce((sum, c) => sum + c.totalSent, 0),
    totalMessagesFailed: campaigns.reduce((sum, c) => sum + c.totalFailed, 0)
  };
};

// Static method to get phone analytics
whatsappAnalyticsSchema.statics.getPhoneAnalytics = async function(userId, phoneNumber) {
  const analytics = await this.find({ userId, senderPhoneNumber: phoneNumber });
  
  const total = analytics.length;
  const delivered = analytics.filter(a => a.status === 'delivered' || a.status === 'read').length;
  const read = analytics.filter(a => a.status === 'read').length;
  const failed = analytics.filter(a => a.status === 'failed').length;
  
  return {
    totalMessages: total,
    deliveredMessages: delivered,
    readMessages: read,
    failedMessages: failed,
    deliveryRate: total > 0 ? (delivered / total) * 100 : 0,
    openRate: total > 0 ? (read / total) * 100 : 0,
    successRate: total > 0 ? ((total - failed) / total) * 100 : 0
  };
};

// Safe model compilation - check if model already exists
const Campaign = mongoose.models.Campaign || mongoose.model("Campaign", campaignSchema);
const WhatsAppAnalytics = mongoose.models.WhatsAppAnalytics || mongoose.model("WhatsAppAnalytics", whatsappAnalyticsSchema);
const CampaignAnalytics = mongoose.models.CampaignAnalytics || mongoose.model("CampaignAnalytics", campaignAnalyticsSchema);
const WhatsAppAccount = mongoose.models.WhatsAppAccount || mongoose.model("WhatsAppAccount", whatsappAccountSchema);

module.exports = {
  Campaign,
  WhatsAppAnalytics,
  CampaignAnalytics,
  WhatsAppAccount
};