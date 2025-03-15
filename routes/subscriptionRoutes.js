const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/authMiddleware");
const {
  getPlans, 
  createOrder, 
  verifyPayment,
  getUserSubscription,
  checkSubscriptionStatus,
  cancelSubscription
} = require("../controllers/subscriptionController");

// Get all available plans
router.get("/plans", getPlans);

// Get current user subscription
router.get("/subscription", authenticate, getUserSubscription);

// Create a new order for plan purchase
router.post("/create-order", authenticate, createOrder);

// Verify payment after Cashfree callback
router.post("/verify-payment", verifyPayment);

// Webhook for Cashfree events
router.post("/cashfree-webhook", checkSubscriptionStatus);

// Cancel current subscription
router.post("/cancel-subscription", authenticate, cancelSubscription);

module.exports = router;