// backend/routes/subscriptionRoute.js
const express = require("express");
const router = express.Router();
const { createSubscriptionOrder, verifyPayment, getSubscriptionStatus } = require("../controllers/subscriptionController");

// POST /api/subscription/createOrder -> Create subscription order
router.post("/createOrder", createSubscriptionOrder);

// GET /api/subscription/verifyPayment/:orderid -> Verify subscription payment
router.get("/verifyPayment/:orderid", verifyPayment);

// GET /api/subscription/status -> Get current subscription status
router.get("/status", getSubscriptionStatus);

module.exports = router;
