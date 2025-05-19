const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  plan:          { type: String, enum: ['free','daily','weekly','monthly','pending'], required: true },
  planRequested: { type: String, enum: ['free','daily','weekly','monthly'], required: function() { return this.plan === 'pending'; } },
  startDate:     { type: Date, required: true },
  endDate:       { type: Date, default: null },
  orderId:       { type: String, required: function() { return this.plan === 'pending'; }, index: true },
}, { timestamps: true });

module.exports = mongoose.model('SubscriptionPlan', subscriptionSchema);
