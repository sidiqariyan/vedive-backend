const mongoose = require("mongoose");

const subscriptionSchema = new mongoose.Schema({
  userId: {
    type: String, // or mongoose.Schema.Types.ObjectId if using a User collection
    required: true,
    unique: true  // one subscription record per user
  },
  plan: {
    type: String,
    enum: ["free", "starter", "business", "enterprise"],
    default: "free"
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  endDate: {
    type: Date,
    default: null
  }
});

module.exports = mongoose.model("Subscription", subscriptionSchema);
