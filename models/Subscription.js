const mongoose = require('mongoose');

const SubscriptionSchema = new mongoose.Schema({
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  plan:            { type: String, enum: ['free','starter','business','enterprise','pending'], required: true },
  startDate:       { type: Date, required: true },
  endDate:         { type: Date, default: null },
  // Use default to ensure this is never null
  cashfreeOrderId: { 
    type: String, 
    default: function() {
      const { v4: uuidv4 } = require('uuid');
      return 'default-' + uuidv4();
    },
    index: { unique: true } 
  },
}, { timestamps: true });

module.exports = mongoose.model('Subscription', SubscriptionSchema);
