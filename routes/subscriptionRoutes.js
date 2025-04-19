// backend/routes/subscriptionRoute.js
const express = require("express");
const router = express.Router();
const { createSubscriptionOrder, verifyPayment, getSubscriptionStatus } = require("../controllers/subscriptionController");

router.post("/createOrder", createSubscriptionOrder);
router.get("/verifyPayment/:orderid", verifyPayment);
router.get("/status", getSubscriptionStatus);

module.exports = router;
