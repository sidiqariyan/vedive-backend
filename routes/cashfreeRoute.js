// backend/routes/cashfreeRoute.js
const express = require("express");
const router = express.Router();
const { newOrderId, checkStatus } = require("../controllers/paymentController");

// POST /api/payment/create -> Create a new order
router.post("/create", newOrderId);

// GET /api/payment/status/:orderid -> Check order status
router.get("/status/:orderid", checkStatus);

module.exports = router;
