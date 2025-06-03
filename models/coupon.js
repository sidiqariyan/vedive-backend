const mongoose = require("mongoose");

const CouponSchema = new mongoose.Schema({
  code: { 
    type: String, 
    required: true, 
    unique: true,
    uppercase: true,
    trim: true 
  },
  description: { 
    type: String, 
    required: true 
  },
  discountType: { 
    type: String, 
    enum: ['percentage', 'fixed'], 
    required: true 
  },
  discountValue: { 
    type: Number, 
    required: true,
    min: 0 
  },
  minOrderAmount: { 
    type: Number, 
    default: 0 
  },
  maxDiscountAmount: { 
    type: Number, 
    default: null // null means no limit
  },
  currency: { 
    type: String, 
    enum: ['INR', 'USD', 'ALL'], 
    default: 'ALL' 
  },
  validFrom: { 
    type: Date, 
    required: true 
  },
  validUntil: { 
    type: Date, 
    required: true 
  },
  usageLimit: { 
    type: Number, 
    default: null // null means unlimited
  },
  usedCount: { 
    type: Number, 
    default: 0 
  },
  isActive: { 
    type: Boolean, 
    default: true 
  },
  applicablePlans: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'SubscriptionPlan' 
  }], // empty array means applicable to all plans
  createdBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Index for better query performance
CouponSchema.index({ code: 1 });
CouponSchema.index({ validFrom: 1, validUntil: 1 });
CouponSchema.index({ isActive: 1 });

// Pre-save middleware to update updatedAt
CouponSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Method to check if coupon is valid
CouponSchema.methods.isValidCoupon = function(orderAmount = 0, currency = 'INR', planId = null) {
  const now = new Date();
  
  // Check if coupon is active
  if (!this.isActive) return { valid: false, message: 'Coupon is inactive' };
  
  // Check date validity
  if (now < this.validFrom) return { valid: false, message: 'Coupon is not yet valid' };
  if (now > this.validUntil) return { valid: false, message: 'Coupon has expired' };
  
  // Check usage limit
  if (this.usageLimit && this.usedCount >= this.usageLimit) {
    return { valid: false, message: 'Coupon usage limit exceeded' };
  }
  
  // Check minimum order amount
  if (orderAmount < this.minOrderAmount) {
    return { valid: false, message: `Minimum order amount is ${this.minOrderAmount}` };
  }
  
  // Check currency compatibility
  if (this.currency !== 'ALL' && this.currency !== currency) {
    return { valid: false, message: `Coupon is only valid for ${this.currency} currency` };
  }
  
  // Check plan applicability
  if (this.applicablePlans.length > 0 && planId) {
    if (!this.applicablePlans.includes(planId)) {
      return { valid: false, message: 'Coupon is not applicable to this plan' };
    }
  }
  
  return { valid: true, message: 'Coupon is valid' };
};

// Method to calculate discount amount
CouponSchema.methods.calculateDiscount = function(orderAmount) {
  let discount = 0;
  
  if (this.discountType === 'percentage') {
    discount = (orderAmount * this.discountValue) / 100;
    // Apply max discount limit if set
    if (this.maxDiscountAmount && discount > this.maxDiscountAmount) {
      discount = this.maxDiscountAmount;
    }
  } else if (this.discountType === 'fixed') {
    discount = this.discountValue;
    // Ensure discount doesn't exceed order amount
    if (discount > orderAmount) {
      discount = orderAmount;
    }
  }
  
  return Math.round(discount * 100) / 100; // Round to 2 decimal places
};

module.exports = mongoose.model("Coupon", CouponSchema);