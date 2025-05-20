const mongoose = require('mongoose');

const SubscriptionSchema = new mongoose.Schema({
  userId:            { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  plan:              { type: String, enum: ['free','daily','weekly','monthly','pending'], required: true },
  startDate:         { type: Date,   required: true },
  endDate:           { type: Date,   default: null },
  cashfreeOrderId:   { type: String, default: null, index: true },
}, { timestamps: true });

module.exports = mongoose.model('Subscription', SubscriptionSchema);
