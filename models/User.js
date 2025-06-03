// models/User.js - Updated User model with Google OAuth fields
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  username: { 
    type: String, 
    required: true, 
    unique: true,
    sparse: true // Allow multiple null values but ensure uniqueness when present
  },
  email: { type: String, required: true, unique: true },
  password: { 
    type: String, 
    required: function() {
      // Password is required only if googleId is not present
      return !this.googleId;
    }
  },
  isVerified: { type: Boolean, default: false },
  verificationToken: String,
  verificationTokenExpires: Date,
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  
  // Google OAuth fields
  googleId: { 
    type: String, 
    sparse: true,
    unique: true 
  },
  authProvider: {
    type: String,
    enum: ['local', 'google'],
    default: 'local'
  },
  photo: { 
    type: String, 
    default: null 
  },
  
  // Subscription fields (from your existing code)
  isPaidUser: { type: Boolean, default: false },
  currentPlan: { type: String, default: null },
  subscriptionEndDate: { type: Date, default: null },
  
  // Add authentication provider tracking
 
}, {
  timestamps: true
});

// Index for better performance
userSchema.index({ email: 1 });
userSchema.index({ googleId: 1 });
userSchema.index({ username: 1 });

module.exports = mongoose.model('User', userSchema);
