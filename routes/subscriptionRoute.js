const express = require("express");
const router = express.Router();
const geoip = require("geoip-lite");
const Cashfree = require("cashfree-sdk"); // Note: Capitalized for clarity, assuming it's a constructor
const { v4: uuidv4 } = require("uuid");
const SubscriptionPlan = require("../models/SubscriptionPlan");
const Order = require("../models/Order");
const { authenticate } = require("../middleware/authMiddleware");

// Instantiate the Cashfree client
const cashfreeClient = new Cashfree({
  appId: process.env.CASHFREE_APP_ID,
  secretKey: process.env.CASHFREE_SECRET_KEY,
  environment: "production", // Use "sandbox" for testing
});

router.get("/plans", async (req, res) => {
  try {
    const plans = await SubscriptionPlan.find({});
    res.json(plans);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch plans" });
  }
});

router.post("/subscribe", authenticate, async (req, res) => {
  try {
    const { planId } = req.body;
    const user = req.user;

    if (user.subscriptionStatus === "active" && user.currentPlan !== "Free") {
      return res.status(400).json({ error: "You already have an active subscription" });
    }

    const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
    const geo = geoip.lookup(ip);
    const country = geo ? geo.country : "US";

    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) {
      return res.status(404).json({ error: "Plan not found" });
    }

    let currency = "USD";
    let amount = plan.prices.find((p) => p.currency === "USD").amount;
    if (country === "IN") {
      currency = "INR";
      amount = plan.prices.find((p) => p.currency === "INR").amount;
    }

    const orderData = {
      orderAmount: amount,
      orderCurrency: currency,
      orderId: `order_${uuidv4()}`,
      customerName: user.name,
      customerEmail: user.email,
      customerPhone: user.phone || "",
      returnUrl: "https://vedive.com/payment-callback",
      notifyUrl: "https://vedive.com/payment-webhook",
    };

    // Use the client instance to create the order
    const order = await cashfreeClient.orders.createOrder(orderData);
    const newOrder = new Order({
      userId: user._id,
      planId: plan._id,
      orderId: order.orderId,
      status: "pending",
    });
    await newOrder.save();

    res.json({ paymentUrl: order.paymentLink });
  } catch (error) {
    console.error("Subscribe error:", error);
    res.status(500).json({ error: "Failed to create subscription order" });
  }
});

module.exports = router;
