const mongoose = require('mongoose');

const linkTrackingSchema = new mongoose.Schema({
  linkTrackingId: { type: String, required: true, unique: true },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
  emailTrackingId: { type: String, required: true },
  recipientEmail: { type: String, required: true },
  recipientName: { type: String },
  originalUrl: { type: String, required: true },
  linkText: { type: String, required: true },
  linkIndex: { type: Number, required: true },
  clicked: { type: Boolean, default: false },
  clickCount: { type: Number, default: 0 },
  clickedAt: { type: Date },
  lastClickedAt: { type: Date },
  userAgent: { type: String },
  ipAddress: { type: String },
  referer: { type: String },
  clickHistory: [{
    clickedAt: { type: Date, default: Date.now },
    userAgent: { type: String },
    ipAddress: { type: String },
    referer: { type: String }
  }]
}, {
  timestamps: true
});

linkTrackingSchema.index({ linkTrackingId: 1 });
linkTrackingSchema.index({ campaignId: 1 });
linkTrackingSchema.index({ recipientEmail: 1 });

// Create and export the model
const LinkTracking = mongoose.model('LinkTracking', linkTrackingSchema);
module.exports = LinkTracking;