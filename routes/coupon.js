const express = require("express");
const router = express.Router();
const Coupon = require("../models/Coupon");
const SubscriptionPlan = require("../models/SubscriptionPlan");
const { authenticate } = require("../middleware/authMiddleware");

// GET /coupons - Get all coupons (admin only)
router.get("/", authenticate, async (req, res) => {
  try {
    // Add admin check here if needed
    // if (req.user.role !== 'admin') {
    //   return res.status(403).json({ error: "Access denied" });
    // }

    const coupons = await Coupon.find({})
      .populate('applicablePlans', 'name')
      .sort({ createdAt: -1 });
    
    res.json(coupons);
  } catch (err) {
    console.error("Error fetching coupons:", err);
    res.status(500).json({ error: "Failed to fetch coupons" });
  }
});

// POST /coupons - Create new coupon (admin only)
router.post("/", authenticate, async (req, res) => {
  try {
    // Add admin check here if needed
    // if (req.user.role !== 'admin') {
    //   return res.status(403).json({ error: "Access denied" });
    // }

    const {
      code,
      description,
      discountType,
      discountValue,
      minOrderAmount,
      maxDiscountAmount,
      currency,
      validFrom,
      validUntil,
      usageLimit,
      applicablePlans
    } = req.body;

    // Validate required fields
    if (!code || !description || !discountType || !discountValue || !validFrom || !validUntil) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Validate discount value
    if (discountType === 'percentage' && (discountValue <= 0 || discountValue > 100)) {
      return res.status(400).json({ error: "Percentage discount must be between 1 and 100" });
    }

    if (discountType === 'fixed' && discountValue <= 0) {
      return res.status(400).json({ error: "Fixed discount must be greater than 0" });
    }

    // Validate dates
    const fromDate = new Date(validFrom);
    const untilDate = new Date(validUntil);
    
    if (fromDate >= untilDate) {
      return res.status(400).json({ error: "Valid until date must be after valid from date" });
    }

    // Check if coupon code already exists
    const existingCoupon = await Coupon.findOne({ code: code.toUpperCase() });
    if (existingCoupon) {
      return res.status(400).json({ error: "Coupon code already exists" });
    }

    // Validate applicable plans if provided
    if (applicablePlans && applicablePlans.length > 0) {
      const validPlans = await SubscriptionPlan.find({ _id: { $in: applicablePlans } });
      if (validPlans.length !== applicablePlans.length) {
        return res.status(400).json({ error: "Some plan IDs are invalid" });
      }
    }

    const coupon = new Coupon({
      code: code.toUpperCase(),
      description,
      discountType,
      discountValue,
      minOrderAmount: minOrderAmount || 0,
      maxDiscountAmount: maxDiscountAmount || null,
      currency: currency || 'ALL',
      validFrom: fromDate,
      validUntil: untilDate,
      usageLimit: usageLimit || null,
      applicablePlans: applicablePlans || [],
      createdBy: req.user._id
    });

    await coupon.save();
    
    // Populate the response
    await coupon.populate('applicablePlans', 'name');
    
    res.status(201).json(coupon);
  } catch (err) {
    console.error("Error creating coupon:", err);
    if (err.code === 11000) {
      return res.status(400).json({ error: "Coupon code already exists" });
    }
    res.status(500).json({ error: "Failed to create coupon" });
  }
});

// PUT /coupons/:id - Update coupon (admin only)
router.put("/:id", authenticate, async (req, res) => {
  try {
    // Add admin check here if needed
    
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) {
      return res.status(404).json({ error: "Coupon not found" });
    }

    const {
      description,
      discountType,
      discountValue,
      minOrderAmount,
      maxDiscountAmount,
      currency,
      validFrom,
      validUntil,
      usageLimit,
      applicablePlans,
      isActive
    } = req.body;

    // Update fields (code cannot be updated to maintain integrity)
    if (description) coupon.description = description;
    if (discountType) coupon.discountType = discountType;
    if (discountValue !== undefined) coupon.discountValue = discountValue;
    if (minOrderAmount !== undefined) coupon.minOrderAmount = minOrderAmount;
    if (maxDiscountAmount !== undefined) coupon.maxDiscountAmount = maxDiscountAmount;
    if (currency) coupon.currency = currency;
    if (validFrom) coupon.validFrom = new Date(validFrom);
    if (validUntil) coupon.validUntil = new Date(validUntil);
    if (usageLimit !== undefined) coupon.usageLimit = usageLimit;
    if (applicablePlans !== undefined) coupon.applicablePlans = applicablePlans;
    if (isActive !== undefined) coupon.isActive = isActive;

    await coupon.save();
    await coupon.populate('applicablePlans', 'name');
    
    res.json(coupon);
  } catch (err) {
    console.error("Error updating coupon:", err);
    res.status(500).json({ error: "Failed to update coupon" });
  }
});

// DELETE /coupons/:id - Delete coupon (admin only)
router.delete("/:id", authenticate, async (req, res) => {
  try {
    // Add admin check here if needed
    
    const coupon = await Coupon.findByIdAndDelete(req.params.id);
    if (!coupon) {
      return res.status(404).json({ error: "Coupon not found" });
    }
    
    res.json({ message: "Coupon deleted successfully" });
  } catch (err) {
    console.error("Error deleting coupon:", err);
    res.status(500).json({ error: "Failed to delete coupon" });
  }
});

// POST /coupons/validate - Validate coupon for use
router.post("/validate", authenticate, async (req, res) => {
  try {
    const { code, orderAmount, currency, planId } = req.body;

    if (!code) {
      return res.status(400).json({ error: "Coupon code is required" });
    }

    const coupon = await Coupon.findOne({ code: code.toUpperCase() });
    if (!coupon) {
      return res.status(404).json({ error: "Invalid coupon code" });
    }

    const validation = coupon.isValidCoupon(orderAmount, currency, planId);
    
    if (!validation.valid) {
      return res.status(400).json({ error: validation.message });
    }

    const discountAmount = coupon.calculateDiscount(orderAmount);
    const finalAmount = Math.max(0, orderAmount - discountAmount);

    res.json({
      valid: true,
      coupon: {
        id: coupon._id,
        code: coupon.code,
        description: coupon.description,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue
      },
      discountAmount,
      finalAmount,
      originalAmount: orderAmount
    });
  } catch (err) {
    console.error("Error validating coupon:", err);
    res.status(500).json({ error: "Failed to validate coupon" });
  }
});

// POST /coupons/apply - Apply coupon to order (called during checkout)
router.post("/apply", authenticate, async (req, res) => {
  try {
    const { couponId } = req.body;

    const coupon = await Coupon.findById(couponId);
    if (!coupon) {
      return res.status(404).json({ error: "Coupon not found" });
    }

    // Increment usage count
    coupon.usedCount += 1;
    await coupon.save();

    res.json({ message: "Coupon applied successfully" });
  } catch (err) {
    console.error("Error applying coupon:", err);
    res.status(500).json({ error: "Failed to apply coupon" });
  }
});

module.exports = router;