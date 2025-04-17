// backend/controllers/subscriptionController.js
const axios = require("axios");
const { secret_key, app_id } = require("../config/secret");
const Subscription = require("../models/SubscriptionPlan");

// Map plan IDs to default prices and durations (ms)
const plans = {
  starter:  { price: 49,  durationMs:   24 * 60 * 60 * 1000 },   // 1 day
  business: { price: 199, durationMs:   7  * 24 * 60 * 60 * 1000 }, // 1 week
  enterprise:{ price: 699, durationMs:  30 * 24 * 60 * 60 * 1000 }, // 1 month
};

// Format Axios errors into status + message
function formatError(err) {
  if (err.response) {
    return {
      status: err.response.status,
      message: err.response.data?.message || JSON.stringify(err.response.data),
    };
  } else if (err.request) {
    return { status: 502, message: "No response from payment gateway" };
  } else {
    return { status: 500, message: err.message };
  }
}

// Create a Cashfree order for a subscription
const createSubscriptionOrder = async (req, res) => {
  const { planId, email, phone, name, amount } = req.body;

  // Validate plan
  const plan = plans[planId];
  if (!plan) {
    return res.status(400).json({ success: false, message: "Invalid planId" });
  }

  // Determine order amount
  const orderAmount = (typeof amount === "number" && amount > 0)
    ? amount
    : plan.price;

  const orderId    = `ORID${Date.now()}`;
  const customerId = `CID${Date.now()}`;

  const payload = {
    customer_details: {
      customer_id:    customerId,
      customer_email: email || "customer@example.com",
      customer_phone: phone || "1234567890",
      customer_name:  name  || "Customer Name",
    },
    order_meta: {
      notify_url:      process.env.CASHFREE_NOTIFY_URL || "https://your-notify-url.com",
      payment_methods: "cc,dc,upi",
    },
    order_amount:   orderAmount,
    order_currency: "INR",
    order_id:       orderId,
    order_note:     `Subscription: ${planId}`,
  };

  try {
    const { data } = await axios.post(
      "https://sandbox.cashfree.com/pg/orders",
      payload,
      {
        headers: {
          accept:           "application/json",
          "x-api-version":  "2022-09-01",
          "content-type":   "application/json",
          "x-client-id":    app_id,
          "x-client-secret": secret_key,
        },
      }
    );
    return res.status(200).json({
      success: true,
      orderId,
      paymentSessionId: data.payment_session_id,
      data,
    });
  } catch (err) {
    console.error("createSubscriptionOrder error:", err.stack);
    const { status, message } = formatError(err);
    return res.status(status).json({ success: false, message });
  }
};

// Verify payment and activate subscription
const verifyPayment = async (req, res) => {
  const { orderid }     = req.params;
  const { order_token, userId, planId } = req.query;

  if (!orderid) {
    return res.status(400).json({ success: false, message: "orderid is required" });
  }
  if (!userId || !plans[planId]) {
    return res.status(400).json({ success: false, message: "userId and valid planId are required" });
  }

  // Build status-lookup URL
  let url = `https://sandbox.cashfree.com/pg/orders/${encodeURIComponent(orderid)}`;
  if (order_token) url += `?order_token=${encodeURIComponent(order_token)}`;

  try {
    const { data } = await axios.get(url, {
      headers: {
        accept:           "application/json",
        "x-api-version":  "2022-09-01",
        "x-client-id":    app_id,
        "x-client-secret": secret_key,
      },
    });
    const status = data.order_status;

    if (status === "PAID" || status === "SUCCESS") {
      // Create or update subscription
      const durationMs = plans[planId].durationMs;
      let sub = await Subscription.findOne({ userId });
      const now = Date.now();

      sub = sub || new Subscription({ userId });
      sub.plan      = planId;
      sub.startDate = now;
      sub.endDate   = durationMs ? now + durationMs : null;
      await sub.save();

      return res.status(200).json({
        success:      true,
        message:      "Payment verified; subscription activated",
        orderStatus:  status,
        subscription: sub,
        data,
      });
    } else {
      return res.status(200).json({
        success:     false,
        message:     "Payment not completed",
        orderStatus: status,
        data,
      });
    }
  } catch (err) {
    console.error("verifyPayment error:", err.stack);
    const { status, message } = formatError(err);
    return res.status(status).json({ success: false, message });
  }
};

// Get current subscription status for a user
const getSubscriptionStatus = async (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ success: false, message: "userId is required" });
  }

  let sub = await Subscription.findOne({ userId });
  if (sub && sub.endDate && Date.now() > sub.endDate) {
    // Expired—downgrade to free
    sub.plan      = "free";
    sub.startDate = Date.now();
    sub.endDate   = null;
    await sub.save();
  }

  return res.status(200).json({
    success:              true,
    hasActiveSubscription: !!(sub && sub.plan !== "free"),
    currentPlan:          sub?.plan || "free",
    subscription:         sub,
  });
};

module.exports = {
  createSubscriptionOrder,
  verifyPayment,
  getSubscriptionStatus,
};
