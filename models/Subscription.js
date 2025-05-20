const mongoose = require('mongoose');

const SubscriptionSchema = new mongoose.Schema({
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  plan:            { type: String, enum: ['free','starter','business','enterprise','pending'], required: true },
  startDate:       { type: Date, required: true },
  endDate:         { type: Date, default: null },
  // Make this required to prevent null values
  cashfreeOrderId: { type: String, required: true, index: { unique: true } },
}, { timestamps: true });

module.exports = mongoose.model('Subscription', SubscriptionSchema);
