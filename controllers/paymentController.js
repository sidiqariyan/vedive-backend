// backend/controllers/paymentController.js
const axios = require("axios");
const { secret_key, app_id } = require("../config/secret");

// Utility to format and send errors from Axios requests
function formatError(error) {
  if (error.response) {
    // Server responded with a status outside 2xx
    return {
      status: error.response.status,
      message: error.response.data?.message || JSON.stringify(error.response.data)
    };
  } else if (error.request) {
    // Request made but no response received
    return {
      status: 502,
      message: "No response received from payment gateway"
    };
  }
  // Other errors
  return {
    status: 500,
    message: error.message
  };
}

// Create a new Cashfree order
const newOrderId = async (req, res) => {
  const { email = "customer@example.com", phone = "1234567890", name = "Customer Name", amount = 1, note = "Order from API" } = req.body;

  // Basic input validation
  if (typeof amount !== "number" || amount <= 0) {
    return res.status(400).json({ success: false, message: "Invalid amount" });
  }

  const orderId = `ORID${Date.now()}`;
  const customerId = `CID${Date.now()}`;

  const payload = {
    customer_details: { customer_id: customerId, customer_email: email, customer_phone: phone, customer_name: name },
    order_meta: { notify_url: process.env.CASHFREE_NOTIFY_URL || "https://your-notify-url.com", payment_methods: "cc,dc,upi" },
    order_amount: amount,
    order_currency: "INR",
    order_id: orderId,
    order_note: note
  };

  const options = {
    method: "POST",
    url: "https://sandbox.cashfree.com/pg/orders",
    headers: {
      accept: "application/json",
      "x-api-version": "2022-09-01",
      "content-type": "application/json",
      "x-client-id": app_id,
      "x-client-secret": secret_key
    },
    data: payload
  };

  try {
    const { data, status } = await axios.request(options);
    return res.status(200).json({
      success: true,
      orderId,
      paymentSessionId: data.payment_session_id,
      data
    });
  } catch (error) {
    console.error("Error in newOrderId:", error.stack);
    const err = formatError(error);
    return res.status(err.status).json({ success: false, message: err.message });
  }
};

// Check status of an existing Cashfree order
const checkStatus = async (req, res) => {
  const { orderid } = req.params;
  if (!orderid) {
    return res.status(400).json({ success: false, message: "Order ID is required" });
  }

  const options = {
    method: "GET",
    url: `https://sandbox.cashfree.com/pg/orders/${encodeURIComponent(orderid)}`,
    headers: {
      accept: "application/json",
      "x-api-version": "2022-09-01",
      "x-client-id": app_id,
      "x-client-secret": secret_key
    }
  };

  try {
    const { data } = await axios.request(options);
    return res.status(200).json({
      success: true,
      orderStatus: data.order_status,
      paymentSessionId: data.payment_session_id,
      data
    });
  } catch (error) {
    console.error("Error in checkStatus:", error.stack);
    const err = formatError(error);
    return res.status(err.status).json({ success: false, message: err.message });
  }
};

module.exports = { newOrderId, checkStatus };
