const express = require("express");
const router = express.Router();
const axios = require("axios");
const geoip = require("geoip-lite");
const { v4: uuidv4 } = require("uuid");
const SubscriptionPlan = require("../models/SubscriptionPlan");
const Order = require("../models/Order");
const { authenticate } = require("../middleware/authMiddleware");

// Cashfree configuration
const environment = process.env.CASHFREE_ENV || "PRODUCTION";
const baseUrl = environment === "SANDBOX" ? "https://sandbox.cashfree.com":"https://api.cashfree.com";
const apiVersion = "2023-08-01"; // Cashfree API version

// Phone number validation regex (e.g., + followed by 10-15 digits)
const phoneRegex = /^\+\d{10,15}$/;

// Route to fetch all subscription plans
router.get("/plans", async (req, res) => {
  try {
    const plans = await SubscriptionPlan.find({});
    res.json(plans);
  } catch (error) {
    console.error("Error fetching plans:", error);
    res.status(500).json({ error: "Failed to fetch plans" });
  }
});

// Route to create a subscription order
router.post("/subscribe", authenticate, async (req, res) => {
  try {
    const { planId } = req.body;
    const phone = "+918920593970"
    const user = req.user;

    // Check if user already has an active subscription
    if (user.subscriptionStatus === "active" && user.currentPlan !== "Free") {
      return res.status(400).json({ error: "You already have an active subscription" });
    }

    // Handle phone number: use provided phone or fall back to user.phone
    if (phone) {
      if (!phoneRegex.test(phone)) {
        return res.status(400).json({
          error: "Invalid phone number format. It should start with '+' followed by 10 to 15 digits (e.g., +919876543210).",
        });
      }
      // Update user's phone number in the database
      user.phone = phone;
      await user.save();
    } else if (!user.phone || !phoneRegex.test(user.phone)) {
      return res.status(400).json({
        error: "A valid phone number is required for subscription. Please provide it in the request or ensure it’s set in your profile.",
      });
    }

    // Determine user's country based on IP address
    const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
    const geo = geoip.lookup(ip);
    const country = geo ? geo.country : "US"; // Default to US if country not determined

    // Fetch the subscription plan
    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) {
      return res.status(404).json({ error: "Plan not found" });
    }

    // Determine currency and amount based on user's country
    let currency = "USD";
    let amount = plan.prices.find((p) => p.currency === "USD")?.amount;
    if (country === "IN") {
      currency = "INR";
      amount = plan.prices.find((p) => p.currency === "INR")?.amount;
    }

    if (amount === undefined) {
      return res.status(400).json({ error: "Price not found for the selected currency" });
    }

    // Generate a unique order ID
    const orderId = `order_${uuidv4()}`;

    // Prepare order data for Cashfree API
    const orderData = {
      order_id: orderId,
      order_amount: amount,
      order_currency: currency,
      customer_details: {
        customer_id: user._id.toString(),
        customer_email: user.email,
        customer_phone: "+918920593970", // Use validated user.phone
      },
      order_meta: {
        return_url: `https://vedive.com/payment-callback?order_id=${orderId}`,
        notify_url: "https://vedive.com/payment-webhook",
      },
    };

    // Cashfree API endpoint and headers
    const url = `${baseUrl}/pg/orders`;
    const headers = {
      "x-api-version": apiVersion,
      "Content-Type": "application/json",
      "x-client-id": process.env.CASHFREE_APP_ID,
      "x-client-secret": process.env.CASHFREE_SECRET_KEY,
    };

    // Create order with Cashfree
    const response = await axios.post(url, orderData, { headers });

    if (response.status !== 200) {
      throw new Error("Failed to create order");
    }

    const paymentUrl = response.data.payment_link;

    // Save order details in the database
    const newOrder = new Order({
      userId: user._id,
      planId: plan._id,
      orderId: response.data.order_id,
      status: "pending",
    });
    await newOrder.save();

    // Return the payment URL to the client
    res.json({ paymentUrl });
  } catch (error) {
    console.error("Subscribe error:", error);

    // Enhanced error handling for Cashfree API responses
    if (error.response && error.response.data) {
      console.error("Cashfree API error:", error.response.data);
      const { code, message } = error.response.data;
      if (code === "customer_details.customer_phone_missing") {
        return res.status(400).json({ error: "Phone number is required for subscription" });
      }
      return res.status(400).json({ error: message || "Failed to create subscription order" });
    }
    res.status(500).json({ error: "Failed to create subscription order" });
  }
});

module.exports = router;
