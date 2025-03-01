const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/authMiddleware");
const subscriptionController = require("../controllers/subscriptionController");

// Select a Subscription Plan
router.post("/select-plan", authenticate, subscriptionController.selectPlan);

// Check Subscription Status
router.get("/check-status/:userId", authenticate, subscriptionController.checkSubscriptionStatus);

// Cancel Subscription
router.post("/cancel-subscription/:userId", authenticate, subscriptionController.cancelSubscription);

module.exports = router;