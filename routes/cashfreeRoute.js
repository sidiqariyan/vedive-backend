const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/authMiddleware");
const subscriptionController = require("../controllers/subscriptionController");

// Create a new subscription order
// cashfreeRoute.js
router.post("/createOrder", authenticate, subscriptionController.createOrder);


// Verify payment and activate subscription 
router.post("/verifyPayment/:orderid", authenticate, subscriptionController.verifyPayment);

// Get current subscription status
router.get("/status", authenticate, subscriptionController.getSubscriptionStatus);

module.exports = router;
