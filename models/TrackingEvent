const mongoose = require("mongoose");

const trackingEventSchema = new mongoose.Schema({
  campaignId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Campaign", 
    required: true
  },
  recipientEmail: { 
    type: String, 
    required: true
  },
  eventType: { 
    type: String, 
    enum: ['open', 'click'], 
    required: true
  },
  timestamp: { 
    type: Date, 
    default: Date.now
  },
  details: { 
    type: String 
  }
});

module.exports = mongoose.models.TrackingEvent || mongoose.model("TrackingEvent", trackingEventSchema);
