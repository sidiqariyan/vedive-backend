const User = require("../models/User");
const SubscriptionPlan = require("../models/SubscriptionPlan");
const { processPayment } = require("../utils/paymentGateway"); // Payment gateway utility

/**
 * Helper Function: Generate Expiry Date for Subscription
 * @param {string} billingCycle - The billing cycle ("monthly" or "yearly")
 * @returns {Date} - The calculated subscription end date
 */
const generateSubscriptionEndDate = (billingCycle) => {
  const now = new Date();
  switch (billingCycle) {
    case "monthly":
      return new Date(now.setMonth(now.getMonth() + 1));
    case "yearly":
      return new Date(now.setFullYear(now.getFullYear() + 1));
    default:
      throw new Error("Invalid billing cycle");
  }
};

/**
 * Fetch All Pricing Plans
 * @route GET /api/pricing-plans
 * @access Public
 */
exports.getPricingPlans = async (req, res) => {
  try {
    const plans = await SubscriptionPlan.find().sort({ price: 1 }); // Sort by price for better UX
    if (!plans || plans.length === 0) {
      return res.status(404).json({ error: "No pricing plans available." });
    }
    res.status(200).json(plans);
  } catch (error) {
    console.error("Error fetching pricing plans:", error.message);
    res.status(500).json({ error: "Failed to fetch pricing plans." });
  }
};

/**
 * Select a Subscription Plan
 * @route POST /api/select-plan
 * @access Private
 */
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
        currency: process.env.DEFAULT_CURRENCY || "INR", // Use environment variable for currency
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

/**
 * Check Subscription Status
 * @route GET /api/check-status/:userId
 * @access Private
 */
exports.checkSubscriptionStatus = async (req, res) => {
  try {
    const { userId } = req.params;

    // Find the user and populate subscription plan details
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

/**
 * Cancel Subscription
 * @route POST /api/cancel-subscription/:userId
 * @access Private
 */
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

/**
 * Initiate Payment for a Subscription Plan
 * @route POST /api/initiate-payment
 * @access Private
 */
exports.initiatePayment = async (req, res) => {
  const { userId, planId, paymentMethod } = req.body;

  try {
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

    // Process payment
    const paymentSuccess = await processPayment({
      amount: plan.price,
      currency: process.env.DEFAULT_CURRENCY || "INR", // Use environment variable for currency
      paymentMethod,
    });

    if (!paymentSuccess) {
      return res.status(400).json({ error: "Payment failed" });
    }

    // Update user's subscription details
    const subscriptionEnd = generateSubscriptionEndDate("monthly"); // Default to monthly
    user.subscriptionPlan = plan._id;
    user.subscriptionStatus = "active";
    user.subscriptionStart = new Date();
    user.subscriptionEnd = subscriptionEnd;
    await user.save();

    res.status(200).json({
      message: "Payment successful. Subscription activated.",
      subscription: {
        plan: plan.name,
        status: "active",
        start: user.subscriptionStart,
        end: user.subscriptionEnd,
      },
    });
  } catch (error) {
    console.error("Error initiating payment:", error);
    res.status(500).json({ error: "Failed to initiate payment" });
  }
};