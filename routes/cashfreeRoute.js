// backend/routes/cashfreeRoute.js
const express = require("express");
const router = express.Router();
const { newOrderId, checkStatus } = require("../controllers/paymentController");

router.post("/create", newOrderId);
router.get("/status/:orderid", checkStatus);

module.exports = router;
