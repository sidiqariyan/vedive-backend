// backend/controllers/paymentController.js
const axios = require("axios");
const { secret_key, app_id } = require("../config/secret");

const newOrderId = async (req, res) => {
  try {
    const orderId = "ORID" + Date.now();
    const customerId = "CID" + Date.now();

    const options = {
      method: "POST",
      url: "https://api.cashfree.com/pg/orders",
      headers: {
        accept: "application/json",
        "x-api-version": "2022-09-01",
        "content-type": "application/json",
        "x-client-id": app_id,
        "x-client-secret": secret_key,
      },
      data: {
        customer_details: {
          customer_id: customerId,
          customer_email: req.body.email || "customer@example.com",
          customer_phone: req.body.phone || "1234567890",
          customer_name: req.body.name || "Customer Name",
        },
        order_meta: {
          notify_url: process.env.CASHFREE_NOTIFY_URL || "https://your-notify-url.com",
          payment_methods: "cc,dc,upi",
        },
        order_amount: req.body.amount || 1,
        order_id: orderId,
        order_currency: "INR",
        order_note: req.body.note || "Order from API",
      },
    };

    const response = await axios.request(options);
    res.status(200).json({
      success: true,
      orderId,
      paymentSessionId: response.data.payment_session_id,
      data: response.data,
    });
  } catch (error) {
    console.error("Error in newOrderId:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

const checkStatus = async (req, res) => {
  const orderid = req.params.orderid;
  try {
    const options = {
      method: "GET",
      url: `https://api.cashfree.com/pg/orders/${orderid}`,
      headers: {
        accept: "application/json",
        "x-api-version": "2022-09-01",
        "x-client-id": app_id,
        "x-client-secret": secret_key,
      },
    };

    const response = await axios.request(options);
    res.status(200).json({
      success: true,
      orderStatus: response.data.order_status,
      paymentSessionId: response.data.payment_session_id,
      data: response.data,
    });
  } catch (error) {
    console.error("Error in checkStatus:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  newOrderId,
  checkStatus,
};
