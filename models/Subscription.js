const mongoose = require('mongoose');

const SubscriptionSchema = new mongoose.Schema({
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  plan:            { type: String, enum: ['free','starter','business','enterprise','pending'], required: true },
  startDate:       { type: Date,   required: true },
  endDate:         { type: Date,   default: null },
  cashfreeOrderId: { type: String, index: { unique: true, sparse: true } },
}, { timestamps: true });

module.exports = mongoose.model('Subscription', SubscriptionSchema);
