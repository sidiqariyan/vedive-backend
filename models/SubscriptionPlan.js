const mongoose = require("mongoose");

const SubscriptionPlanSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  duration: { type: Number, required: true }, // in days, 0 for free
  prices: [
    {
      currency: { type: String, required: true },
      amount: { type: Number, required: true },
    },
  ],
  features: [{ type: String }],
  limits: {
    campaignsPerMonth: { type: Number, default: 0 }, // 0 for unlimited
  },
});

module.exports = mongoose.model("SubscriptionPlan", SubscriptionPlanSchema);
