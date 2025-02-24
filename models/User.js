const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isVerified: { type: Boolean, default: false },
    verificationToken: { type: String },
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
  },
  { 
    timestamps: true, 
    toJSON: { virtuals: true }, 
    toObject: { virtuals: true } 
  }
);

// Virtual field to populate campaigns for a user
UserSchema.virtual("campaigns", {
  ref: "Campaign",        // The model to use
  localField: "_id",      // Find campaigns where `localField`
  foreignField: "userId"  // is equal to `foreignField`
});

module.exports = mongoose.model("User", UserSchema);
