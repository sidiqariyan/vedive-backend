const mongoose = require("mongoose");

const ToolSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true, // Ensure tool names are unique
    },
    description: {
      type: String,
      required: true,
    },
    requiredPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionPlan", // Reference to the SubscriptionPlan model
      required: true, // Minimum plan required to access this tool
    },
    isActive: {
      type: Boolean,
      default: true, // Whether the tool is currently available
    },
  },
  {
    timestamps: true, // Add createdAt and updatedAt fields
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

module.exports = mongoose.model("Tool", ToolSchema);