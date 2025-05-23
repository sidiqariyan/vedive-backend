const express = require("express");
const router = express.Router();
const cashfree = require("cashfree-sdk");
const User = require("../models/User");
const Order = require("../models/Order");
const SubscriptionPlan = require("../models/SubscriptionPlan");

router.post("/callback", async (req, res) => {
  try {
    const { orderId, orderStatus } = req.body;
    const order = await Order.findOne({ orderId });
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (orderStatus === "PAID") {
      order.status = "success";
      await order.save();

      const user = await User.findById(order.userId);
      const plan = await SubscriptionPlan.findById(order.planId);

      user.isPaidUser = true;
      user.currentPlan = plan.name;
      user.subscriptionPlan = plan._id;
      user.subscriptionStatus = "active";
      user.subscriptionStart = new Date();
      user.subscriptionEndDate = new Date(Date.now() + plan.duration * 24 * 60 * 60 * 1000);

      await user.save();
      res.json({ message: "Payment successful" });
    } else {
      order.status = "failed";
      await order.save();
      res.json({ message: "Payment failed" });
    }
  } catch (error) {
    console.error("Payment callback error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/webhook", async (req, res) => {
  const signature = req.headers["x-webhook-signature"];
  const timestamp = req.headers["x-webhook-timestamp"];
  const rawBody = req.rawBody;

  const isValid = cashfree.webhooks.validateSignature(signature, timestamp, rawBody, process.env.CASHFREE_WEBHOOK_SECRET);
  if (!isValid) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const { orderId, orderStatus } = req.body;
  const order = await Order.findOne({ orderId });
  if (!order) {
    return res.status(404).json({ error: "Order not found" });
  }

  if (orderStatus === "PAID") {
    order.status = "success";
    await order.save();

    const user = await User.findById(order.userId);
    const plan = await SubscriptionPlan.findById(order.planId);

    user.isPaidUser = true;
    user.currentPlan = plan.name;
    user.subscriptionPlan = plan._id;
    user.subscriptionStatus = "active";
    user.subscriptionStart = new Date();
    user.subscriptionEndDate = new Date(Date.now() + plan.duration * 24 * 60 * 60 * 1000);

    await user.save();
  }
  res.status(200).json({ status: "Webhook received" });
});

module.exports = router;
