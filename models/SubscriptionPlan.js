const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  orderId: {
    type: String,
    required: true,
    unique: true
  },
  amount: {
    type: Number,
    required: true
  },
  planId: {
    type: String,
    required: true,
    enum: ['free', 'starter', 'business', 'enterprise']
  },
  duration: {
    type: String,
    required: true,
    enum: ['1-day', '1-week', '1-month']
  },
  status: {
    type: String,
    required: true,
    enum: ['CREATED', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED'],
    default: 'CREATED'
  },
  paymentSessionId: {
    type: String
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

// Update the updatedAt field before saving
OrderSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Subscription', OrderSchema);
