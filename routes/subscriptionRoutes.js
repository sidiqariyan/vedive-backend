const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/authMiddleware");
const subscriptionController = require("../controllers/subscriptionController");

// Create a new subscription order
router.post("/createOrder", authenticate, subscriptionController.createSubscriptionOrder);
// Verify payment and activate subscription
// Note: ensure param name matches controller's expectation (orderid)
router.get(
  "/verify-payment/:orderid",
  authenticate,
  subscriptionController.verifyPayment
);

// Get current subscription status
router.get(
  "/status",
  authenticate,
  subscriptionController.getSubscriptionStatus
);

module.exports = router;
