const express = require("express");
const router = express.Router();
const axios = require("axios");
const { app_id, secret_key } = require("../../secret");

// Create a new payment order
router.post("/payment", async (req, res) => {
  const { price, plan } = req.body;

  if (!price || !plan) {
    return res.status(400).json({ error: "Price and plan details are required." });
  }

  try {
    const options = {
      method: "POST",
      url: "https://api.cashfree.com/pg/orders", // Updated to production endpoint
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

// Check payment status
router.get("/status/:orderid", async (req, res) => {
  const { orderid } = req.params;

  try {
    const options = {
      method: "GET",
      url: `https://api.cashfree.com/pg/orders/${orderid}`, // Updated to production endpoint
      headers: {
        accept: "application/json",
        "x-api-version": "2022-09-01",
        "x-client-id": app_id,
        "x-client-secret": secret_key,
      },
    };

    const response = await axios.request(options);

    if (response.data.order_status === "PAID") {
      return res.redirect("http://localhost:5173/success"); // Redirect to success page
    } else if (response.data.order_status === "ACTIVE") {
      return res.redirect(`http://localhost:5173/${response.data.payment_session_id}`); // Redirect to payment page
    } else {
      return res.redirect("http://localhost:5173/failure"); // Redirect to failure page
    }
  } catch (error) {
    console.error("Error checking payment status:", error.message);
    return res.status(500).json({ error: "Failed to check payment status." });
  }
});

module.exports = router;