// models/User.js - Updated for better OAuth support
const mongoose = require('mongoose');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  username: { 
    type: String, 
    required: function() {
      return !this.googleId; // Only required if not a Google user
    }, 
    unique: true,
    sparse: true
  },
  email: { 
    type: String, 
    required: true, 
    unique: true,
    lowercase: true, // Automatically convert to lowercase
    trim: true
  },
  password: { 
    type: String, 
    required: function() {
      return !this.googleId; // Only required if not a Google user
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
  photo: { 
    type: String, 
    default: null 
  },
  authProvider: {
    type: String,
    enum: ['local', 'google'],
    default: 'local'
  },
  
  // Subscription fields
  isPaidUser: { type: Boolean, default: false },
  currentPlan: { type: String, default: null },
  subscriptionEndDate: { type: Date, default: null }
  
}, {
  timestamps: true
});

// Indexes for better performance
userSchema.index({ email: 1 });
userSchema.index({ googleId: 1 });
userSchema.index({ username: 1 });

// Pre-save middleware
userSchema.pre('save', function(next) {
  // For Google users without password, generate a random one
  if (this.isNew && this.authProvider === 'google' && !this.password) {
    this.password = crypto.randomBytes(32).toString('hex');
  }
  
  // Auto-generate username for Google users if not provided
  if (this.isNew && this.authProvider === 'google' && !this.username && this.email) {
    let baseUsername = this.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '');
    if (baseUsername.length < 3) {
      baseUsername = 'user' + baseUsername;
    }
    this.username = baseUsername + '_' + Date.now();
  }
  
  next();
});

// Instance method to check if user can reset password
userSchema.methods.canResetPassword = function() {
  return this.authProvider === 'local';
};

// Instance method to get safe user data
userSchema.methods.toSafeObject = function() {
  return {
    _id: this._id,
    name: this.name,
    username: this.username,
    email: this.email,
    isVerified: this.isVerified,
    authProvider: this.authProvider,
    photo: this.photo,
    isPaidUser: this.isPaidUser,
    currentPlan: this.currentPlan,
    createdAt: this.createdAt
  };
};

module.exports = mongoose.model('User', userSchema);