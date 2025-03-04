const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/authMiddleware");
const subscriptionController = require("../controllers/subscriptionController");

// Import Models
const User = require("../models/User");
const SubscriptionPlan = require("../models/SubscriptionPlan");

// Import Utility Functions
const { processPayment } = require("../utils/paymentGateway");
const { generateSubscriptionEndDate } = require("../utils/helpers");

/**
 * @route   GET /api/pricing-plans
 * @desc    Fetch all available pricing plans (Public Route)
 * @access  Public
 */
router.get("/pricing-plans", subscriptionController.getPricingPlans);

/**
 * @route   POST /api/select-plan
 * @desc    Select a subscription plan (Authenticated User)
 * @access  Private
 */
router.post("/select-plan", authenticate, subscriptionController.selectPlan);

/**
 * @route   GET /api/check-status
 * @desc    Check the subscription status of the authenticated user
 * @access  Private
 */
router.get("/check-status", authenticate, subscriptionController.checkSubscriptionStatus);

/**
 * @route   POST /api/cancel-subscription
 * @desc    Cancel the authenticated user's subscription
 * @access  Private
 */
router.post("/cancel-subscription", authenticate, subscriptionController.cancelSubscription);

/**
 * @route   POST /api/initiate-payment
 * @desc    Initiate payment for a subscription plan
 * @access  Private
 */
router.post("/initiate-payment", authenticate, async (req, res) => {
  try {
    const {
      planId,
      paymentMethod,
      amount,
      currency,
      orderId,
      customerName,
      customerEmail,
      customerPhone = "N/A", // Default to "N/A" if phone is missing
    } = req.body;

    console.log("Initiating payment with payload:", req.body);

    // Validate required fields
    if (!planId || !paymentMethod || !amount || !currency || !orderId || !customerName || !customerEmail) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Get authenticated user ID
    const userId = req.user.id;

    // Find the user
    console.log("Searching for user with ID:", userId);
    const user = await User.findById(userId);
    if (!user) {
      console.error("User not found for ID:", userId);
      return res.status(404).json({ error: "User not found" });
    }

    // Find the subscription plan
    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) {
      console.error("Subscription plan not found for ID:", planId);
      return res.status(404).json({ error: "Subscription plan not found" });
    }

    // Process payment
    try {
      const paymentResponse = await processPayment({
        amount,
        currency,
        orderId,
        customerName,
        customerEmail,
        customerPhone,
      });

      if (!paymentResponse || paymentResponse.status !== "OK") {
        return res.status(400).json({ error: "Payment processing failed" });
      }

      // Determine subscription duration dynamically based on the plan type
      const subscriptionEnd = generateSubscriptionEndDate(plan.duration || "monthly");

      // Update user's subscription details
      user.subscriptionPlan = plan._id;
      user.subscriptionStatus = "active";
      user.subscriptionStart = new Date();
      user.subscriptionEnd = subscriptionEnd;
      await user.save();

      return res.status(200).json({
        message: "Payment successful. Subscription activated.",
        subscription: {
          plan: plan.name,
          status: "active",
          start: user.subscriptionStart,
          end: user.subscriptionEnd,
        },
      });
    } catch (paymentError) {
      if (paymentError.message.includes("401")) {
        console.error("Payment Gateway Authentication Failed:", paymentError.message);
        return res.status(401).json({ error: "Payment authentication failed. Please check credentials." });
      }
      console.error("Payment Processing Error:", paymentError.message);
      return res.status(500).json({ error: "Failed to process payment" });
    }
  } catch (error) {
    console.error("Error initiating payment:", error.message);
    return res.status(500).json({ error: "Server error: Unable to process payment" });
  }
});

module.exports = router;
