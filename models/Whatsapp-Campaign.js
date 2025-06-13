const mongoose = require('mongoose');

// Campaign Schema
const campaignSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  campaignName: {
    type: String,
    required: true
  },
  toolType: {
    type: String,
    required: true,
    enum: ['whatsapp-bulk-sender', 'email-marketing', 'sms-campaign']
  },
  messageContent: {
    type: String,
    required: true
  },
  // Fix: Ensure recipients is properly defined as array of strings
  recipients: {
    type: [String], // Alternative syntax that's more explicit
    required: true,
    validate: {
      validator: function(v) {
        return Array.isArray(v) && v.length > 0;
      },
      message: 'Recipients must be a non-empty array'
    }
  },
  status: {
    type: String,
    enum: ['draft', 'in-progress', 'completed', 'failed'],
    default: 'draft'
  },
  totalSent: {
    type: Number,
    default: 0
  },
  totalFailed: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Pre-save middleware to ensure recipients are properly formatted
campaignSchema.pre('save', function(next) {
  // Ensure recipients is always an array
  if (this.recipients && !Array.isArray(this.recipients)) {
    if (typeof this.recipients === 'string') {
      // If it's a single string, convert to array
      this.recipients = [this.recipients];
    } else {
      return next(new Error('Recipients must be an array of strings'));
    }
  }
  
  // Clean up phone numbers (remove any whitespace, ensure they're strings)
  if (this.recipients) {
    this.recipients = this.recipients.map(recipient => {
      if (typeof recipient !== 'string') {
        return String(recipient).trim();
      }
      return recipient.trim();
    }).filter(recipient => recipient.length > 0);
  }
  
  next();
});

// WhatsApp Analytics Schema
const whatsAppAnalyticsSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    required: true,
    index: true
  },
  messageId: {
    type: String,
    required: true,
    unique: true
  },
  phoneNumber: {
    type: String,
    required: true
  },
  messageContent: {
    type: String,
    required: true
  },
  processedMessage: {
    type: String
  },
  trackingId: {
    type: String,
    required: true,
    unique: true
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read', 'failed'],
    default: 'sent'
  },
  sentAt: {
    type: Date,
    default: Date.now
  },
  deliveredAt: {
    type: Date
  },
  readAt: {
    type: Date
  },
}, {
  timestamps: true
});

// Campaign Analytics Schema
const campaignAnalyticsSchema = new mongoose.Schema({
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    required: true,
    unique: true,
    index: true
  },
  userId: {
    type: String,
    required: true,
    index: true
  },
  totalMessages: {
    type: Number,
    default: 0
  },
  deliveredMessages: {
    type: Number,
    default: 0
  },
  readMessages: {
    type: Number,
    default: 0
  },
  failedMessages: {
    type: Number,
    default: 0
  },
  totalClicks: {
    type: Number,
    default: 0
  },
  uniqueClicks: {
    type: Number,
    default: 0
  },
  deliveryRate: {
    type: Number,
    default: 0
  },
  openRate: {
    type: Number,
    default: 0
  },
  clickRate: {
    type: Number,
    default: 0
  },
  clickThroughRate: {
    type: Number,
    default: 0
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
});

// Method to update analytics
campaignAnalyticsSchema.methods.updateAnalytics = async function() {
  try {
    const WhatsAppAnalytics = mongoose.model('WhatsAppAnalytics');
    const analytics = await WhatsAppAnalytics.find({ campaignId: this.campaignId });
    
    this.totalMessages = analytics.length;
    this.deliveredMessages = analytics.filter(a => a.status === 'delivered' || a.status === 'read').length;
    this.readMessages = analytics.filter(a => a.status === 'read').length;
    this.failedMessages = analytics.filter(a => a.status === 'failed').length;
    
    this.deliveryRate = this.totalMessages > 0 ? Math.round((this.deliveredMessages / this.totalMessages) * 100) : 0;
    this.openRate = this.totalMessages > 0 ? Math.round((this.readMessages / this.totalMessages) * 100) : 0;
    this.lastUpdated = new Date();
    
    await this.save();
  } catch (error) {
    console.error('Error updating campaign analytics:', error);
  }
};

// Check if models already exist before creating them
let Campaign, WhatsAppAnalytics, CampaignAnalytics;

try {
  Campaign = mongoose.model('Campaign');
} catch (error) {
  Campaign = mongoose.model('Campaign', campaignSchema);
}

try {
  WhatsAppAnalytics = mongoose.model('WhatsAppAnalytics');
} catch (error) {
  WhatsAppAnalytics = mongoose.model('WhatsAppAnalytics', whatsAppAnalyticsSchema);
}

try {
  CampaignAnalytics = mongoose.model('CampaignAnalytics');
} catch (error) {
  CampaignAnalytics = mongoose.model('CampaignAnalytics', campaignAnalyticsSchema);
}

module.exports = {
  Campaign,
  WhatsAppAnalytics,
  CampaignAnalytics,
};