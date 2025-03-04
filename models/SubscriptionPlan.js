const mongoose = require("mongoose");

const SubscriptionPlanSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true, // Ensure plan names are unique (e.g., "Free", "Basic", "Pro")
      lowercase: true, // Ensure case-insensitive uniqueness
      trim: true, // Remove leading/trailing whitespace
    },
    price: {
      type: Number,
      required: true,
      default: 0, // Default to 0 for free plans
      min: 0, // Ensure price is non-negative
    },
    description: {
      type: String,
      required: true,
      trim: true, // Remove leading/trailing whitespace
    },
    features: {
      type: [String], // List of features included in the plan (e.g., ["Tool A", "Tool B"])
      required: true,
      validate: {
        validator: (features) => features.length > 0, // Ensure at least one feature is included
        message: "At least one feature must be included in the plan.",
      },
    },
    maxTools: {
      type: Number,
      required: true,
      default: 0, // Maximum number of tools accessible (0 for unlimited in Free plans)
      min: -1, // -1 indicates unlimited tools
    },
    isActive: {
      type: Boolean,
      default: true, // Whether the plan is currently available for purchase
    },
  },
  {
    timestamps: true, // Add createdAt and updatedAt fields
    toJSON: { virtuals: true }, // Include virtuals when converting to JSON
    toObject: { virtuals: true }, // Include virtuals when converting to plain object
  }
);

// Indexes for better query performance
SubscriptionPlanSchema.index({ isActive: 1 }); // Index for active/inactive plans

// Virtual Field Example: Display whether the plan is unlimited
SubscriptionPlanSchema.virtual("isUnlimited").get(function () {
  return this.maxTools === -1; // True if maxTools is -1 (unlimited)
});

module.exports = mongoose.model("SubscriptionPlan", SubscriptionPlanSchema);