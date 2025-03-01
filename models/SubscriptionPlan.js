const mongoose = require("mongoose");

const SubscriptionPlanSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true, // Ensure plan names are unique (e.g., "Free", "Basic", "Pro")
    },
    price: {
      type: Number,
      required: true,
      default: 0, // Default to 0 for free plans
    },
    description: {
      type: String,
      required: true,
    },
    features: {
      type: [String], // List of features included in the plan (e.g., ["Tool A", "Tool B"])
      required: true,
    },
    maxTools: {
      type: Number,
      required: true,
      default: 0, // Maximum number of tools accessible (0 for unlimited in Free plans)
    },
    isActive: {
      type: Boolean,
      default: true, // Whether the plan is currently available for purchase
    },
  },
  {
    timestamps: true, // Add createdAt and updatedAt fields
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

module.exports = mongoose.model("SubscriptionPlan", SubscriptionPlanSchema);