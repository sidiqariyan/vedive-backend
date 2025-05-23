const express = require("express");
const router = express.Router();
const geoip = require("geoip-lite");
const { Cashfree } = require("cashfree-pg"); // Import the correct SDK
const { v4: uuidv4 } = require("uuid");
const SubscriptionPlan = require("../models/SubscriptionPlan");
const Order = require("../models/Order");
const { authenticate } = require("../middleware/authMiddleware");

// Configure Cashfree credentials and environment
Cashfree.XClientId = process.env.CASHFREE_APP_ID;       // Your Cashfree App ID
Cashfree.XClientSecret = process.env.CASHFREE_SECRET_KEY; // Your Cashfree Secret Key
Cashfree.XEnvironment = Cashfree.Environment.SANDBOX;   // Use SANDBOX for testing, PRODUCTION for live

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

    const orderId = `order_${uuidv4()}`;
    const request = {
      order_amount: amount,
      order_currency: currency,
      order_id: orderId,
      customer_details: {
        customer_id: user._id.toString(),
        customer_email: user.email,
        customer_phone: user.phone || "",
      },
      order_meta: {
        return_url: `https://vedive.com/payment-callback?order_id=${orderId}`,
      },
    };

    // Create the order using Cashfree SDK
    Cashfree.PGCreateOrder("2023-08-01", request) // Use the correct API version per Cashfree docs
      .then((response) => {
        const paymentUrl = response.data.payment_link;
        const newOrder = new Order({
          userId: user._id,
          planId: plan._id,
          orderId: response.data.order_id,
          status: "pending",
        });
        return newOrder.save().then(() => {
          res.json({ paymentUrl });
        });
      })
      .catch((error) => {
        console.error("Error creating order:", error.response?.data?.message || error);
        res.status(500).json({ error: "Failed to create order" });
      });
  } catch (error) {
    console.error("Subscribe error:", error);
    res.status(500).json({ error: "Failed to create subscription order" });
  }
});

module.exports = router;
