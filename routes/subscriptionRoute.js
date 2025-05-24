// routes/subscriptionRoute.js
const express = require("express");
const router = express.Router();
const axios = require("axios");
const geoip = require("geoip-lite");
const { v4: uuidv4 } = require("uuid");
const SubscriptionPlan = require("../models/SubscriptionPlan");
const Order = require("../models/Order");
const { authenticate } = require("../middleware/authMiddleware");

// Determine environment: SANDBOX or PRODUCTION
const environment = (process.env.CASHFREE_ENV || "SANDBOX").toUpperCase();
const isProd = environment === "PRODUCTION";

// Base URLs for API and checkout
const baseUrl = isProd
  ? "https://api.cashfree.com"
  : "https://sandbox.cashfree.com";
const checkoutBaseUrl = isProd
  ? "https://www.cashfree.com"
  : "https://sandbox.cashfree.com";

// Pick credentials based on environment
const clientId = isProd
  ? process.env.CASHFREE_APP_ID
  : process.env.CASHFREE_SANDBOX_APP_ID;
const clientSecret = isProd
  ? process.env.CASHFREE_SECRET_KEY
  : process.env.CASHFREE_SANDBOX_SECRET_KEY;

// API version (verify this in the docs if you upgrade)
const apiVersion = "2023-08-01";

// GET /plans — list all subscription plans
router.get("/plans", async (req, res) => {
  try {
    const plans = await SubscriptionPlan.find({});
    res.json(plans);
  } catch (err) {
    console.error("Error fetching plans:", err);
    res.status(500).json({ error: "Failed to fetch plans" });
  }
});

// POST /subscribe — create a Cashfree order
router.post("/subscribe", authenticate, async (req, res) => {
  try {
    const { planId, phone } = req.body;
    const user = req.user;

    // Prevent duplicate active subscriptions
    if (user.subscriptionStatus === "active" && user.currentPlan !== "Free") {
      return res.status(400).json({ error: "You already have an active subscription" });
    }

    // Phone validation
    if (!phone || !phone.startsWith("+")) {
      return res.status(400).json({ error: "Valid phone number with country code is required" });
    }

    // Geo-locate country from IP (fallback to US)
    const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
    const geo = geoip.lookup(ip);
    const country = geo?.country === "IN" ? "IN" : "US";

    // Fetch plan & determine amount/currency
    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) {
      return res.status(404).json({ error: "Plan not found" });
    }

    const priceObj = plan.prices.find(p => p.currency === (country === "IN" ? "INR" : "USD"));
    if (!priceObj) {
      return res.status(400).json({ error: "Price not found for the selected currency" });
    }
    const { amount, currency } = priceObj;

    // Build unique order ID
    const orderId = `order_${uuidv4()}`;

    // Cashfree order payload
    const orderData = {
      order_id: orderId,
      order_amount: amount,
      order_currency: currency,
      customer_details: {
        customer_id: user._id.toString(),
        customer_email: user.email,
        customer_phone: phone,
      },
      order_meta: {
        return_url: `https://vedive.com/payment-callback?order_id=${orderId}`,
        notify_url: "https://vedive.com/payment-webhook",
      },
    };

    // Request headers
    const headers = {
      "x-api-version": apiVersion,
      "Content-Type": "application/json",
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
    };

    // Create order
    const cfRes = await axios.post(`${baseUrl}/pg/orders`, orderData, { headers });

    // Check success
    if (cfRes.status !== 200 || !cfRes.data.payment_session_id) {
      console.error("Unexpected Cashfree response:", cfRes.data);
      throw new Error("Failed to create order");
    }

    // Save order in our DB
    await Order.create({
      userId: user._id,
      planId: plan._id,
      orderId: cfRes.data.order_id,
      status: "pending",
    });

    // Return the hosted checkout URL
    const paymentUrl = `${checkoutBaseUrl}/pg/checkout?session_id=${cfRes.data.payment_session_id}`;
    res.json({ paymentUrl });

  } catch (err) {
    console.error("Subscribe error:", err);
    // If Cashfree returned an error payload, include it
    if (err.response?.data) {
      return res.status(500).json({
        error: "Failed to create subscription order",
        details: err.response.data,
      });
    }
    res.status(500).json({ error: "Failed to create subscription order" });
  }
});

module.exports = router;
