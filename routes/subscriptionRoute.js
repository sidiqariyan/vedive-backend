require("dotenv").config();
const express = require("express");
const router = express.Router();
const axios = require("axios");
const geoip = require("geoip-lite");
const { v4: uuidv4 } = require("uuid");
const SubscriptionPlan = require("../models/SubscriptionPlan");
const Order = require("../models/Order");
const Coupon = require("../models/Coupon");
const { authenticate } = require("../middleware/authMiddleware");

// Determine environment (sandbox or production)
const environment = (process.env.CASHFREE_ENV || "PRODUCTION").toUpperCase();
const isProd = environment === "PRODUCTION";

// Resolve Cashfree endpoints
const baseUrl = isProd
  ? "https://api.cashfree.com" 
  : "https://sandbox.cashfree.com"; 
const checkoutBaseUrl = isProd
  ? "https://www.cashfree.com" 
  : "https://sandbox.cashfree.com"; 

// Resolve Cashfree credentials
const clientId = isProd
  ? "92091559e09e1ef5eb102b66b4519029"
  : process.env.CASHFREE_SANDBOX_APP_ID;
const clientSecret = isProd
  ? "cfsk_ma_prod_952ee152bb1a344252f96a977558f926_f8ec5951"
  : process.env.CASHFREE_SANDBOX_SECRET_KEY;

// Fail fast if credentials are missing
if (!clientId || !clientSecret) {
  console.error(`
    🚨 Missing Cashfree credentials! 🚨
    environment: ${environment}
    clientId: ${clientId ? "(set)" : "(undefined)"}
    clientSecret: ${clientSecret ? "(set)" : "(undefined)"}
  `);
  process.exit(1);
}

const apiVersion = "2023-08-01";

// GET /plans - List all subscription plans
router.get("/plans", async (req, res) => {
  try {
    const plans = await SubscriptionPlan.find({});
    res.json(plans);
  } catch (err) {
    console.error("Error fetching plans:", err);
    res.status(500).json({ error: "Failed to fetch plans" });
  }
});

// POST /subscribe - Create a Cashfree order with coupon support
router.post("/subscribe", authenticate, async (req, res) => {
  try {
    const { planId, phone, couponCode } = req.body;
    const user = req.user;

    console.log("Subscription request:", { planId, phone, userId: user._id, couponCode });

    // Check for active subscription
    if (user.subscriptionStatus === "active" && user.currentPlan !== "Free") {
      console.log("Blocked: User has active subscription");
      return res.status(400).json({ error: "You already have an active subscription" });
    }

    // Validate phone number
    if (!phone || !phone.startsWith("+")) {
      console.log("Blocked: Invalid phone number:", phone);
      return res.status(400).json({ error: "Valid phone number with country code is required" });
    }

    // Determine country based on IP (INR for India, USD otherwise)
    const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
    const geo = geoip.lookup(ip);
    const country = geo?.country === "IN" ? "IN" : "US";
    console.log("User country:", country);

    // Fetch subscription plan
    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) {
      console.log("Blocked: Plan not found:", planId);
      return res.status(404).json({ error: "Plan not found" });
    }

    // Check price availability for the user's currency
    const priceObj = plan.prices.find(p => p.currency === (country === "IN" ? "INR" : "USD"));
    if (!priceObj) {
      console.log("Blocked: No price for currency:", country === "IN" ? "INR" : "USD");
      return res.status(400).json({ error: "Price not found for the selected currency" });
    }
    
    const originalAmount = priceObj.amount;
    let finalAmount = originalAmount;
    let appliedCoupon = null;
    let discountAmount = 0;

    // 🔥 VALIDATE AND APPLY COUPON
    if (couponCode && couponCode.trim()) {
      console.log("Processing coupon:", couponCode);
      
      const coupon = await Coupon.findOne({ code: couponCode.trim().toUpperCase() });
      if (!coupon) {
        console.log("Coupon not found:", couponCode);
        return res.status(400).json({ error: "Invalid coupon code" });
      }

      // Validate coupon
      const validationResult = coupon.isValidCoupon(originalAmount, priceObj.currency, planId);
      if (!validationResult.valid) {
        console.log("Coupon validation failed:", validationResult.message);
        return res.status(400).json({ error: validationResult.message });
      }

      // Calculate discount
      discountAmount = coupon.calculateDiscount(originalAmount);
      finalAmount = Math.max(originalAmount - discountAmount, 0); // Prevent negative amounts
      appliedCoupon = coupon;

      console.log("Coupon applied successfully:", {
        originalAmount,
        discountAmount,
        finalAmount,
        couponCode: coupon.code
      });
    }

    // 🔥 ENSURE FINAL AMOUNT IS PROPERLY CALCULATED
    // Round to 2 decimal places to avoid floating point issues
    finalAmount = Math.round(finalAmount * 100) / 100;
    
    // Minimum amount validation (Cashfree usually has minimum limits)
    if (finalAmount < 1) {
      console.log("Final amount too low:", finalAmount);
      return res.status(400).json({ error: "Final amount is too low for payment processing" });
    }

    console.log("🔥 FINAL PAYMENT AMOUNTS:", {
      originalAmount,
      discountAmount,
      finalAmount,
      currency: priceObj.currency
    });

    // Generate unique order ID
    const orderId = `order_${uuidv4()}`;

    // 🔥 CASHFREE ORDER PAYLOAD WITH CORRECT FINAL AMOUNT
    const orderData = {
      order_id: orderId,
      order_amount: finalAmount, // 🔥 This is the key fix - using finalAmount
      order_currency: priceObj.currency,
      customer_details: {
        customer_id: user._id.toString(),
        customer_email: user.email,
        customer_phone: phone,
      },
      order_meta: {
        return_url: `https://yourdomain.com/payment-callback?order_id=${orderId}`,
        notify_url: "https://yourdomain.com/payment-webhook",
      },
    };

    console.log("🔥 Sending to Cashfree:", orderData);

    // Cashfree API configuration
    const headers = {
      "x-api-version": apiVersion,
      "Content-Type": "application/json",
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
    };

    // Create order with Cashfree
    const cfRes = await axios.post(`${baseUrl}/pg/orders`, orderData, { headers });

    if (cfRes.status !== 200 || !cfRes.data.payment_session_id) {
      console.error("Unexpected Cashfree response:", cfRes.data);
      throw new Error("Failed to create order with Cashfree");
    }

    console.log("✅ Cashfree order created successfully:", {
      orderId: cfRes.data.order_id,
      amount: finalAmount,
      currency: priceObj.currency
    });

    // Save order with coupon details
    const orderRecord = await Order.create({
      userId: user._id,
      planId: plan._id,
      orderId: cfRes.data.order_id,
      status: "pending",
      couponCode: appliedCoupon?.code || null,
      originalAmount,
      discountedAmount: finalAmount,
      discountAmount: discountAmount,
      currency: priceObj.currency
    });

    // Increment coupon usage if applied
    if (appliedCoupon) {
      await Coupon.findByIdAndUpdate(appliedCoupon._id, {
        $inc: { usedCount: 1 },
      });
      console.log("✅ Coupon usage incremented:", appliedCoupon.code);
    }

    // Return payment_session_id to frontend
    res.json({ 
      payment_session_id: cfRes.data.payment_session_id,
      order_id: cfRes.data.order_id,
      final_amount: finalAmount,
      original_amount: originalAmount,
      discount_amount: discountAmount,
      currency: priceObj.currency
    });

  } catch (err) {
    console.error("Subscribe error:", err);
    res.status(500).json({ error: "Failed to create subscription order" });
  }
});

// GET /status - Get subscription status
router.get("/status", authenticate, async (req, res) => {
  try {
    const user = req.user;
    const subscriptionInfo = {
      status: user.subscriptionStatus || "inactive",
      currentPlan: user.currentPlan || "Free",
      subscriptionEndDate: user.subscriptionEndDate || null,
    };
    res.json(subscriptionInfo);
  } catch (err) {
    console.error("Error fetching subscription status:", err);
    res.status(500).json({ error: "Failed to fetch subscription status" });
  }
});

module.exports = router;