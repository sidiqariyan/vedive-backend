const express = require("express");
const router = express.Router();
const {
  createSubscriptionOrder,
  verifyPayment,
  getSubscriptionStatus,
} = require("../controllers/subscriptionController");

// Middleware to log and validate JSON input
router.use((req, res, next) => {
  if (req.method === "POST" || req.method === "PUT") {
    console.log("Incoming Request Body:", req.body);
  }
  next();
});

// POST /api/subscription/createOrder -> Create subscription order
router.post(
  "/createOrder",
  // Validate required fields: only planId is mandatory here
  (req, res, next) => {
    const { planId } = req.body;
    if (!planId) {
      return res.status(400).json({
        success: false,
        message: "Missing required field: planId is required.",
      });
    }
    next();
  },
  createSubscriptionOrder
);

// GET /api/subscription/verifyPayment/:orderid -> Verify subscription payment
router.get(
  "/verifyPayment/:orderid",
  verifyPayment
);

// GET /api/subscription/status -> Get current subscription status
router.get(
  "/status",
  getSubscriptionStatus
);

module.exports = router;
