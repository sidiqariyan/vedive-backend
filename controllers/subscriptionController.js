const mongoose = require('mongoose');
const axios = require("axios");
const { secret_key, app_id } = require("../config/secret");
const Subscription = require("../models/SubscriptionPlan");

const planDetails = {
  starter: { price: 49, duration: 1 * 24 * 60 * 60 * 1000, label: "1-day" },
  business: { price: 199, duration: 7 * 24 * 60 * 60 * 1000, label: "1-week" },
  enterprise: { price: 699, duration: 30 * 24 * 60 * 60 * 1000, label: "1-month" }
};

const createSubscriptionOrder = async (req, res) => {
  try {
    const { planId, email, phone, name } = req.body;
    const orderId = "ORID" + Date.now();
    const customerId = "CID" + Date.now();

    const selectedPlan = planDetails[planId] || { price: 1 };
    const orderAmount = selectedPlan.price;

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

  const selectedPlan = planDetails[planId] || { duration: 1 * 24 * 60 * 60 * 1000, label: "1-day" };

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
          planId,
          orderId: orderid,
          amount: selectedPlan.price,
          duration: selectedPlan.label,
          status: orderStatus,
          startDate: new Date(),
          endDate: new Date(Date.now() + selectedPlan.duration)
        });
      } else {
        sub.planId = planId;
        sub.amount = selectedPlan.price;
        sub.duration = selectedPlan.label;
        sub.status = orderStatus;
        sub.startDate = new Date();
        sub.endDate = new Date(Date.now() + selectedPlan.duration);
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
  if (subscription && subscription.endDate && new Date() > subscription.endDate) {
    subscription.planId = "free";
    subscription.startDate = new Date();
    subscription.endDate = null;
    subscription.status = "EXPIRED";
    subscription.duration = "1-day";
    await subscription.save();
  }
  res.status(200).json({
    success: true,
    hasActiveSubscription: subscription ? subscription.planId !== "free" : false,
    currentPlan: subscription ? subscription.planId : "free",
    subscription
  });
};

module.exports = {
  createOrder: createSubscriptionOrder,
  createSubscriptionOrder,
  verifyPayment,
  getSubscriptionStatus
};
