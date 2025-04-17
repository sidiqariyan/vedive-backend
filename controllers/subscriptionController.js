const axios = require("axios");
const { secret_key, app_id } = require("../config/secret");
const Subscription = require("../models/SubscriptionPlan");

// Optional safeguard: map plan IDs to prices
const planPrices = {
  starter: 49,
  business: 199,
  enterprise: 699,
};

const createSubscriptionOrder = async (req, res) => {
  try {
    const { planId, email, phone, name, amount } = req.body;
    const orderId = "ORID" + Date.now();
    const customerId = "CID" + Date.now();

    // Use the provided amount or fallback to the mapped price
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
    res.status(200).json({
      success: true,
      orderId,
      paymentSessionId: response.data.payment_session_id,
      data: response.data
    });
  } catch (error) {
    console.error("Error in createSubscriptionOrder:", error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

const verifyPayment = async (req, res) => {
  const orderid = req.params.orderid;
  const orderToken = req.query.order_token;
  const userId = req.query.userId || "user123";
  const planId = req.query.planId || "starter";

  let planDuration = 0;
  switch (planId) {
    case "starter":
      planDuration = 24 * 60 * 60 * 1000; // 1 day
      break;
    case "business":
      planDuration = 7 * 24 * 60 * 60 * 1000; // 1 week
      break;
    case "enterprise":
      planDuration = 30 * 24 * 60 * 60 * 1000; // 1 month
      break;
    default:
      planDuration = 0; // free plan – no expiry
      break;
  }

  try {
    let url = `https://sandbox.cashfree.com/pg/orders/${orderid}`;
    if (orderToken) {
      url += `?order_token=${orderToken}`;
    }
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
    console.log("Cashfree response data:", response.data);
    const orderStatus = response.data.order_status;

    if (orderStatus === "PAID" || orderStatus === "SUCCESS") {
      let sub = await Subscription.findOne({ userId });
      if (!sub) {
        sub = new Subscription({
          userId,
          plan: planId,
          startDate: new Date(),
          endDate: planDuration ? new Date(Date.now() + planDuration) : null
        });
      } else {
        sub.plan = planId;
        sub.startDate = new Date();
        sub.endDate = planDuration ? new Date(Date.now() + planDuration) : null;
      }
      await sub.save();

      res.status(200).json({
        success: true,
        message: "Payment verified and subscription activated.",
        orderStatus,
        subscription: sub,
        data: response.data
      });
    } else {
      res.status(200).json({
        success: false,
        message: "Payment not completed.",
        orderStatus,
        data: response.data
      });
    }
  } catch (error) {
    console.error("Error in verifyPayment:", error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

const getSubscriptionStatus = async (req, res) => {
  const userId = req.query.userId || "user123";
  let subscription = await Subscription.findOne({ userId });
  if (subscription) {
    if (subscription.endDate && new Date() > subscription.endDate) {
      subscription.plan = "free";
      subscription.startDate = new Date();
      subscription.endDate = null;
      await subscription.save();
    }
  }
  res.status(200).json({
    success: true,
    hasActiveSubscription: subscription ? subscription.plan !== "free" : false,
    currentPlan: subscription ? subscription.plan : "free",
    subscription
  });
};

module.exports = {
  // alias it so your route stays the same:
  createOrder: createSubscriptionOrder,
  verifyPayment,
  getSubscriptionStatus
};
