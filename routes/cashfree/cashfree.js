const express = require("express");
const router = express.Router();
const axios = require("axios");
const { app_id, secret_key } = require("../../secret/secret");

// Create a new payment order
router.post("/payment", async (req, res) => {
  const { price, plan } = req.body;

  if (!price || !plan) {
    return res.status(400).json({ error: "Price and plan details are required." });
  }

  try {
    const options = {
      method: "POST",
      url: "https://sandbox.cashfree.com/pg/orders",
      headers: {
        accept: "application/json",
        "x-api-version": "2022-09-01",
        "content-type": "application/json",
        "x-client-id": app_id,
        "x-client-secret": secret_key,
      },
      data: {
        customer_details: {
          customer_id: "CID89898" + Date.now(),
          customer_email: "waleedsdev@gmail.com", // Replace with dynamic user email
          customer_phone: "7498608775", // Replace with dynamic user phone
          customer_name: "Waleed Shaikh", // Replace with dynamic user name
        },
        order_meta: {
          notify_url: "https://webhook.site/d057a7d4-c09a-405c-b44b-3067a1559a07",
          payment_methods: "cc,dc,upi",
        },
        order_amount: price,
        order_id: "ORID665456" + Date.now(),
        order_currency: "INR",
        order_note: `Purchase of ${plan} plan`,
      },
    };

    const response = await axios.request(options);
    return res.status(200).json(response.data.payment_session_id);
  } catch (error) {
    console.error("Error creating Cashfree order:", error.message);
    return res.status(500).json({ error: "Failed to create payment order." });
  }
});

module.exports = router;