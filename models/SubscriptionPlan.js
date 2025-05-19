const mongoose = require("mongoose");

const subscriptionSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true,
  },
  plan: {
    type: String,
    enum: ["free", "starter", "business", "enterprise"],
    default: "free",
  },
  startDate: {
    type: Date,
    default: Date.now,
  },
  endDate: {
    type: Date,
    default: null,
  },
});

module.exports = mongoose.model("Subscription", subscriptionSchema);
