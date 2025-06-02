// models/User.js - Add these fields to your existing schema
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // Your existing fields...
  name: { type: String, required: true },
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isVerified: { type: Boolean, default: false },
  verificationToken: String,
  verificationTokenExpires: Date,
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  
  // Add these new fields for Google OAuth:
  googleId: { 
    type: String, 
    sparse: true, // Allows null values but ensures uniqueness when present
    unique: true 
  },
  photo: { 
    type: String, 
    default: null 
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('User', userSchema);
