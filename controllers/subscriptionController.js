const User = require("../models/User");
const SubscriptionPlan = require("../models/SubscriptionPlan");
const { processPayment } = require("../utils/paymentGateway"); // Assuming you have a payment gateway utility
require("dotenv").config();

// Helper Function: Generate Expiry Date for Subscription
const generateSubscriptionEndDate = (billingCycle) => {
  const now = new Date();
  if (billingCycle === "monthly") {
    return new Date(now.setMonth(now.getMonth() + 1));
  } else if (billingCycle === "yearly") {
    return new Date(now.setFullYear(now.getFullYear() + 1));
  }
  return null;
};

// Select a Subscription Plan
exports.selectPlan = async (req, res) => {
  try {
    const { userId, planId, paymentMethod, billingCycle } = req.body;

    // Validate required fields
    if (!userId || !planId || !paymentMethod || !billingCycle) {
      return res.status(400).json({ error: "All fields are required" });
    }

    // Find the user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Find the subscription plan
    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) {
      return res.status(404).json({ error: "Subscription plan not found" });
    }

    // Process payment (if the plan is not free)
    if (plan.price > 0) {
      const paymentSuccess = await processPayment({
        amount: plan.price,
        currency: "USD", // Adjust based on your requirements
        paymentMethod,
      });

      if (!paymentSuccess) {
        return res.status(400).json({ error: "Payment failed" });
      }
    }

    // Update user's subscription details
    const subscriptionEnd = generateSubscriptionEndDate(billingCycle);
    user.subscriptionPlan = plan._id;
    user.subscriptionStatus = "active";
    user.subscriptionStart = new Date();
    user.subscriptionEnd = subscriptionEnd;
    await user.save();

    res.status(200).json({
      message: "Subscription plan selected successfully",
      subscription: {
        plan: plan.name,
        status: "active",
        start: user.subscriptionStart,
        end: user.subscriptionEnd,
      },
    });
  } catch (error) {
    console.error("Error selecting subscription plan:", error);
    res.status(500).json({ error: "Failed to select subscription plan" });
  }
};

// Check Subscription Status
exports.checkSubscriptionStatus = async (req, res) => {
  try {
    const { userId } = req.params;

    // Find the user
    const user = await User.findById(userId).populate("subscriptionPlan");
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check subscription status
    const currentDate = new Date();
    if (user.subscriptionStatus === "active" && user.subscriptionEnd < currentDate) {
      user.subscriptionStatus = "inactive";
      await user.save();
    }

    res.status(200).json({
      subscriptionStatus: user.subscriptionStatus,
      subscriptionPlan: user.subscriptionPlan?.name || "No plan",
      subscriptionEnd: user.subscriptionEnd,
    });
  } catch (error) {
    console.error("Error checking subscription status:", error);
    res.status(500).json({ error: "Failed to check subscription status" });
  }
};

// Cancel Subscription
exports.cancelSubscription = async (req, res) => {
  try {
    const { userId } = req.params;

    // Find the user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Update subscription status to "cancelled"
    user.subscriptionStatus = "cancelled";
    user.subscriptionEnd = new Date(); // End subscription immediately
    await user.save();

    res.status(200).json({ message: "Subscription cancelled successfully" });
  } catch (error) {
    console.error("Error cancelling subscription:", error);
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
};