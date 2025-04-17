const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/authMiddleware");
const subscriptionController = require("../controllers/subscriptionController");
router.post("/createOrder", authenticate, subscriptionController.createOrder);
router.get("/verifyPayment/:orderId", authenticate, subscriptionController.verifyPayment);
router.get("/status", authenticate, subscriptionController.getSubscriptionStatus);
module.exports = router;
