const axios = require("axios");
const { secret_key, app_id } = require("../config/secret");
const Subscription = require("../models/SubscriptionPlan");

// Plan configurations: price (INR) and duration in milliseconds
const planConfigs = {
  free: { price: 0, duration: 0 },       // lifetime free
  daily: { price: 99, duration: 1 * 24 * 60 * 60 * 1000 },    // 1 day
  weekly: { price: 499, duration: 7 * 24 * 60 * 60 * 1000 },  // 1 week
  monthly: { price: 1999, duration: 30 * 24 * 60 * 60 * 1000 } // 1 month
};

// Helper to get authenticated userId
const getUserId = (req) => {
  if (req.user && req.user.id) return req.user.id;
  throw new Error('Missing authenticated user ID');
};

const createSubscriptionOrder = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { planId = "free", email, phone, name } = req.body;
    if (!planConfigs[planId]) {
      return res.status(400).json({ success: false, message: "Invalid planId" });
    }

    const now = new Date();
    const { price, duration } = planConfigs[planId];
    const expiry = duration ? new Date(now.getTime() + duration) : null;

    // Handle free plan immediately without payment
    if (planId === "free") {
      let sub = await Subscription.findOne({ userId });
      if (!sub) {
        sub = new Subscription({ userId, plan: "free", startDate: now, endDate: null });
      } else {
        sub.plan = "free";
        sub.startDate = now;
        sub.endDate = null;
      }
      await sub.save();
      return res.status(200).json({ success: true, message: "Free plan activated.", subscription: sub });
    }

    // Paid plans: create order via Cashfree
    const orderId = "ORID" + Date.now();
    const customerId = "CID" + Date.now();

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
          customer_id: customerId,
          customer_email: email || "customer@example.com",
          customer_phone: phone || "1234567890",
          customer_name: name || "Customer Name",
        },
        order_meta: {
          notify_url: process.env.CASHFREE_NOTIFY_URL || "https://your-notify-url.com",
          payment_methods: "cc,dc,upi",
        },
        order_amount: price,
        order_id: orderId,
        order_currency: "INR",
        order_note: `Subscription order for plan ${planId}`,
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
    console.error("Error in createSubscriptionOrder:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const verifyPayment = async (req, res) => {
  try {
    const userId = getUserId(req);
    const orderid = req.params.orderid;
    const orderToken = req.query.order_token;

    let url = `https://sandbox.cashfree.com/pg/orders/${orderid}`;
    if (orderToken) url += `?order_token=${orderToken}`;

    const options = {
      method: "GET",
      url,
      headers: {
        accept: "application/json",
        "x-api-version": "2022-09-01",
        "x-client-id": app_id,
        "x-client-secret": secret_key,
      },
    };

    const response = await axios.request(options);
    const { order_status: orderStatus, order_amount: orderAmount } = response.data;

    // Determine plan by amount
    const planId = Object.keys(planConfigs).find(
      key => planConfigs[key].price === orderAmount
    ) || "free";

    const now = new Date();
    const duration = planConfigs[planId].duration;
    const expiry = duration ? new Date(now.getTime() + duration) : null;

    if (orderStatus === "PAID" || orderStatus === "SUCCESS") {
      let sub = await Subscription.findOne({ userId });
      if (!sub) {
        sub = new Subscription({ userId, plan: planId, startDate: now, endDate: expiry });
      } else {
        sub.plan = planId;
        sub.startDate = now;
        sub.endDate = expiry;
      }
      await sub.save();

      return res.status(200).json({
        success: true,
        message: "Payment verified and subscription activated.",
        orderStatus,
        subscription: sub,
        data: response.data,
      });
    }

    res.status(200).json({ success: false, message: "Payment not completed.", orderStatus, data: response.data });
  } catch (error) {
    console.error("Error in verifyPayment:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSubscriptionStatus = async (req, res) => {
  try {
    const userId = getUserId(req);
    const now = new Date();
    let subscription = await Subscription.findOne({ userId });

    // If new user with no subscription, assign free plan
    if (!subscription) {
      subscription = new Subscription({ userId, plan: "free", startDate: now, endDate: null });
      await subscription.save();
    } else if (subscription.endDate && now > subscription.endDate) {
      // Downgrade to free after expiry
      subscription.plan = "free";
      subscription.startDate = now;
      subscription.endDate = null;
      await subscription.save();
    }

    res.status(200).json({
      success: true,
      hasActiveSubscription: subscription.plan !== "free",
      currentPlan: subscription.plan,
      subscription,
    });
  } catch (error) {
    console.error("Error in getSubscriptionStatus:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { createSubscriptionOrder, verifyPayment, getSubscriptionStatus };
