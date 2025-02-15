const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

// Define a schema for the counter collection
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // The name of the counter (e.g., "userId")
  seq: { type: Number, default: 0 },    // The current value of the counter
});

// Create a model for the counter
const Counter = mongoose.model("Counter", counterSchema);

// Define the user schema
const userSchema = new mongoose.Schema(
  {
    userId: { type: Number, unique: true }, // Incrementing ID for each user
    name: { type: String, required: true, trim: true },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: (value) => /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value),
        message: "Invalid email address",
      },
    },
    password: { type: String, required: false, trim: true },
    role: { type: String, enum: ["admin", "user"], default: "user" },
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
    isVerified: { type: Boolean, default: false },
    verificationToken: { type: String },
    verificationExpires: { type: Date },
  },
  { timestamps: true }
);

// Middleware to generate an incrementing ID before saving a user
userSchema.pre("save", async function (next) {
  try {
    if (!this.userId) {
      const counter = await Counter.findByIdAndUpdate(
        { _id: "userId" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );
      this.userId = counter.seq;
    }
    if (this.isModified("password") && this.password) {
      this.password = await bcrypt.hash(this.password, 10);
    }
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("User", userSchema);