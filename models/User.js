const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    phone: { type: String, default: null },
    role: { type: String, enum: ["user", "admin"], default: "user" },

    // ← NEW: allow storing a Google sub/ID if they sign up with Google
    googleId: { type: String, unique: true, sparse: true },

    // ← OPTIONAL: store Google profile picture URL
    photo: { type: String, default: null },

    isVerified: { type: Boolean, default: false },
    verificationToken: { type: String },
    verificationTokenExpires: { type: Date },

    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },

    // subscription fields (unchanged)
    isPaidUser: { type: Boolean, default: false },
    currentPlan: { type: String, default: "Free" },
    subscriptionPlan: { type: mongoose.Schema.Types.ObjectId, ref: "SubscriptionPlan", default: null },
    subscriptionStatus: { type: String, enum: ["active", "inactive", "trial", "cancelled"], default: "inactive" },
    subscriptionStart: { type: Date, default: null },
    subscriptionEndDate: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

const User = mongoose.model("User", UserSchema);
module.exports = User;
