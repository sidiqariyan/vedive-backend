// models/User.js - Updated with new fields
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
  
  // NEW FIELDS - Add these three fields
  companyName: { 
    type: String, 
    required: true,
    trim: true,
    maxlength: 100
  },
  country: { 
    type: String, 
    required: true,
    trim: true,
    maxlength: 60
  },
  industry: { 
    type: String, 
    required: true,
    trim: true,
    maxlength: 50
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
userSchema.index({ country: 1 }); // NEW INDEX for country queries
userSchema.index({ industry: 1 }); // NEW INDEX for industry queries

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

// Instance method to get safe user data - UPDATED to include new fields
userSchema.methods.toSafeObject = function() {
  return {
    _id: this._id,
    name: this.name,
    username: this.username,
    email: this.email,
    companyName: this.companyName, // NEW
    country: this.country, // NEW
    industry: this.industry, // NEW
    isVerified: this.isVerified,
    authProvider: this.authProvider,
    photo: this.photo,
    isPaidUser: this.isPaidUser,
    currentPlan: this.currentPlan,
    createdAt: this.createdAt
  };
};

module.exports = mongoose.model('User', userSchema);