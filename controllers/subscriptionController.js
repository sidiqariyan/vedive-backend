const axios = require("axios");
const { secret_key, app_id } = require("../config/secret");
const Subscription = require("../models/SubscriptionPlan");

// Map plan IDs to prices (fallback) and durations in milliseconds
const planPrices = {
  starter: 49,
  business: 199,
  enterprise: 699,
};
const planDurations = {
  starter: 1 * 24 * 60 * 60 * 1000,      // 1 day
  business: 7 * 24 * 60 * 60 * 1000,     // 1 week
  enterprise: 30 * 24 * 60 * 60 * 1000,   // 1 month
};

// POST /api/subscription/createOrder
const createSubscriptionOrder = async (req, res) => {
  try {
    const { planId, userId, email, phone, name, amount } = req.body;
    if (!planId || !userId) {
      return res.status(400).json({ success: false, message: "Missing planId or userId" });
    }

    const orderId = "ORID" + Date.now();
    const customerId = "CID" + Date.now();
    const orderAmount = amount || planPrices[planId] || 1;

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
      data: {
        customer_details: {
          customer_id: customerId,
          customer_email: email || "customer@example.com",
          customer_phone: phone || "1234567890",
          customer_name: name || "Customer Name"
        },
        order_meta: {
          notify_url: process.env.CASHFREE_NOTIFY_URL || "https://your-notify-url.com",
          payment_methods: "cc,dc,upi"
        },
        order_amount: orderAmount,
        order_id: orderId,
        order_currency: "INR",
        order_note: `Subscription order for plan ${planId}`
      }
    };

    const response = await axios.request(options);
    return res.status(200).json({
      success: true,
      orderId,
      planId,
      userId,
      paymentSessionId: response.data.payment_session_id,
      data: response.data
    });
  } catch (error) {
    console.error("Error in createSubscriptionOrder:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/subscription/verifyPayment/:orderid
const verifyPayment = async (req, res) => {
  const orderid = req.params.orderid;
  const orderToken = req.query.order_token;
  let userId = req.query.userId;
  let planId = req.query.planId;

  try {
    // Build the Cashfree API URL
    let url = `https://sandbox.cashfree.com/pg/orders/${orderid}`;
    if (orderToken) url += `?order_token=${orderToken}`;

    // Fetch order status from Cashfree
    const options = {
      method: "GET",
      url,
      headers: {
        accept: "application/json",
        "x-api-version": "2022-09-01",
        "x-client-id": app_id,
        "x-client-secret": secret_key
      }
    };
    const response = await axios.request(options);
    const orderStatus = response.data.order_status;

    // Infer planId from the order_note if not provided
    if (!planId && response.data.order_note) {
      const match = response.data.order_note.match(/plan\s+(\w+)$/i);
      if (match) planId = match[1].toLowerCase();
    }
    if (!planId) {
      return res.status(400).json({ success: false, message: "planId is required" });
    }
    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    // Determine duration based on planId
    const planDuration = planDurations[planId];
    if (!planDuration) {
      return res.status(400).json({ success: false, message: `Invalid planId: ${planId}` });
    }

    // Activate subscription if payment successful
    if (orderStatus === "PAID" || orderStatus === "SUCCESS") {
      let sub = await Subscription.findOne({ userId });
      const start = new Date();
      const end = new Date(Date.now() + planDuration);

      if (!sub) {
        sub = new Subscription({ userId, plan: planId, startDate: start, endDate: end });
      } else {
        sub.plan = planId;
        sub.startDate = start;
        sub.endDate = end;
      }
      await sub.save();

      return res.status(200).json({
        success: true,
        message: "Payment verified and subscription activated.",
        orderStatus,
        subscription: sub,
        data: response.data
      });
    }

    // Payment not completed
    return res.status(200).json({ success: false, message: "Payment not completed.", orderStatus, data: response.data });
  } catch (error) {
    console.error("Error in verifyPayment:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/subscription/status
const getSubscriptionStatus = async (req, res) => {
  const userId = req.query.userId || "user123";
  let subscription = await Subscription.findOne({ userId });
  if (subscription && subscription.endDate && new Date() > subscription.endDate) {
    subscription.plan = "free";
    subscription.startDate = new Date();
    subscription.endDate = null;
    await subscription.save();
  }
  return res.status(200).json({
    success: true,
    hasActiveSubscription: subscription ? subscription.plan !== "free" : false,
    currentPlan: subscription ? subscription.plan : "free",
    subscription
  });
};

module.exports = {
  createSubscriptionOrder,
  verifyPayment,
  getSubscriptionStatus
};
