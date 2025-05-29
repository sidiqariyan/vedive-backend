const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    phone: { type: String, default: null },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    isVerified: { type: Boolean, default: false },
    verificationToken: { type: String },
    verificationTokenExpires: { type: Date }, // Add this missing field
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
    // Subscription-related fields
    isPaidUser: { type: Boolean, default: false },
    currentPlan: { type: String, default: "Free" },
    subscriptionPlan: { type: mongoose.Schema.Types.ObjectId, ref: "SubscriptionPlan", default: null },
    subscriptionStatus: { type: String, enum: ["active", "inactive", "trial", "cancelled"], default: "inactive" },
    subscriptionStart: { type: Date, default: null },
    subscriptionEndDate: { type: Date, default: null }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

const User = mongoose.model("User", UserSchema);
module.exports = User;
