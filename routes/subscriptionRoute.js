require("dotenv").config();        // ← load from .env in development

const express = require("express");
const router = express.Router();
const axios = require("axios");
const geoip = require("geoip-lite");
const { v4: uuidv4 } = require("uuid");
const SubscriptionPlan = require("../models/SubscriptionPlan");
const Order = require("../models/Order");
const { authenticate } = require("../middleware/authMiddleware");

// Determine environment
const environment = (process.env.CASHFREE_ENV || "PRODUCTION").toUpperCase();
const isProd = environment === "PRODUCTION";

// Resolve endpoints
const baseUrl = isProd
  ? "https://api.cashfree.com"
  : "https://sandbox.cashfree.com";
const checkoutBaseUrl = isProd
  ? "https://www.cashfree.com"
  : "https://sandbox.cashfree.com";

// Resolve credentials
const clientId = isProd
  ? "92091559e09e1ef5eb102b66b4519029"
  : process.env.CASHFREE_SANDBOX_APP_ID;
const clientSecret = isProd
  ? "cfsk_ma_prod_952ee152bb1a344252f96a977558f926_f8ec5951"
  : process.env.CASHFREE_SANDBOX_SECRET_KEY;

// Fail fast if creds are missing
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
// POST /subscribe — create a Cashfree order
router.post("/subscribe", authenticate, async (req, res) => {
  try {
    const { planId, phone } = req.body;
    const user = req.user;

    // Prevent duplicate subscriptions
    if (user.subscriptionStatus === "active" && user.currentPlan !== "Free") {
      return res.status(400).json({ error: "You already have an active subscription" });
    }

    // Validate phone number
    if (!phone || !phone.startsWith("+")) {
      return res.status(400).json({ error: "Valid phone number with country code is required" });
    }

    // Determine country based on IP (INR for India, USD otherwise)
    const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
    const geo = geoip.lookup(ip);
    const country = geo?.country === "IN" ? "IN" : "US";

    // Fetch subscription plan
    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) {
      return res.status(404).json({ error: "Plan not found" });
    }

    const priceObj = plan.prices.find(p => p.currency === (country === "IN" ? "INR" : "USD"));
    if (!priceObj) {
      return res.status(400).json({ error: "Price not found for the selected currency" });
    }
    const { amount, currency } = priceObj;

    // Generate unique order ID
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

    // Cashfree API configuration
    const isProd = process.env.CASHFREE_ENV?.toUpperCase() === "PRODUCTION";
    const baseUrl = isProd ? "https://api.cashfree.com" : "https://sandbox.cashfree.com";
    const clientId = isProd ? "92091559e09e1ef5eb102b66b4519029" : process.env.CASHFREE_SANDBOX_APP_ID;
    const clientSecret = isProd ? "cfsk_ma_prod_952ee152bb1a344252f96a977558f926_f8ec5951" : process.env.CASHFREE_SANDBOX_SECRET_KEY;

    const headers = {
      "x-api-version": "2023-08-01",
      "Content-Type": "application/json",
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
    };

    // Create order with Cashfree
    const cfRes = await axios.post(`${baseUrl}/pg/orders`, orderData, { headers });

    if (cfRes.status !== 200 || !cfRes.data.payment_session_id) {
      console.error("Unexpected Cashfree response:", cfRes.data);
      throw new Error("Failed to create order");
    }

    // Save order in database
    await Order.create({
      userId: user._id,
      planId: plan._id,
      orderId: cfRes.data.order_id,
      status: "pending",
    });

    // Return payment_session_id to frontend
    res.json({ payment_session_id: cfRes.data.payment_session_id });

  } catch (err) {
    console.error("Subscribe error:", err);
    res.status(500).json({ error: "Failed to create subscription order", details: err.response?.data });
  }
});

module.exports = router;
