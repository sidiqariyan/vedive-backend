const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true }, // Full name
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // Store password as plain text (ensure hashing is done before saving)
    isVerified: { type: Boolean, default: false },
    verificationToken: { type: String },
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },

    // Subscription-related fields
    subscriptionPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionPlan", // Reference to the SubscriptionPlan model
      default: null, // Default to no subscription (Free Plan can be handled in logic)
    },
    subscriptionStatus: {
      type: String,
      enum: ["active", "inactive", "trial", "cancelled"],
      default: "inactive",
    },
    subscriptionStart: { type: Date, default: null },
    subscriptionEnd: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

module.exports = mongoose.model("User", UserSchema);