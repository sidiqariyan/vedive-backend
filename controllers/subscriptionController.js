// controllers/subscriptionController.js

const mongoose = require('mongoose');
const axios    = require('axios');
const { secret_key, app_id } = require('../config/secret');
const Subscription = require('../models/SubscriptionPlan');

const planDetails = {
  starter:    { price: 49,  duration: 1  * 24 * 60 * 60 * 1000, label: "1-day"   },
  business:   { price: 199, duration: 7  * 24 * 60 * 60 * 1000, label: "1-week"  },
  enterprise: { price: 699, duration: 30 * 24 * 60 * 60 * 1000, label: "1-month" }
};

// Create an order on Cashfree
const createSubscriptionOrder = async (req, res) => {
  try {
    const { planId, email, phone, name } = req.body;
    const userId = req.user._id; // from authenticate middleware

    const selectedPlan = planDetails[planId] || { price: 1 };
    const orderAmount = selectedPlan.price;
    const orderId     = "ORID" + Date.now();
    const customerId  = "CID"  + Date.now();

    const options = {
      method: "POST",
      url: "https://sandbox.cashfree.com/pg/orders",
      headers: {
        accept: "application/json",
        "x-api-version":   "2022-09-01",
        "content-type":    "application/json",
        "x-client-id":     app_id,
        "x-client-secret": secret_key
      },
      data: {
        customer_details: {
          customer_id:    customerId,
          customer_email: email || req.user.email || "customer@example.com",
          customer_phone: phone || req.user.phone || "1234567890",
          customer_name:  name  || req.user.name || "Customer"
        },
        order_meta: {
          notify_url:      process.env.CASHFREE_NOTIFY_URL || "https://your-notify-url.com",
          payment_methods: "cc,dc,upi"
        },
        order_amount:   orderAmount,
        order_id:       orderId,
        order_currency: "INR",
        order_note:     `Subscription order for plan ${planId}`
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
    console.error("Error in createSubscriptionOrder:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Verify payment & activate subscription
const verifyPayment = async (req, res) => {
  try {
    const orderId    = req.params.orderId;
    const orderToken = req.query.order_token;
    const userId     = req.user._id;
    const planId     = req.query.planId || req.body.planId || "starter";

    const selectedPlan = planDetails[planId] || { price: 1, duration: 1 * 24 * 60 * 60 * 1000, label: "1-day" };
    let url = `https://sandbox.cashfree.com/pg/orders/${orderId}`;
    if (orderToken) url += `?order_token=${orderToken}`;

    const options = {
      method: "GET",
      url,
      headers: {
        accept: "application/json",
        "x-api-version":   "2022-09-01",
        "x-client-id":     app_id,
        "x-client-secret": secret_key
      }
    };

    const response    = await axios.request(options);
    const orderStatus = response.data.order_status;
    const now         = new Date();
    const newEnd      = new Date(now.getTime() + selectedPlan.duration);

    let sub = await Subscription.findOne({ userId: mongoose.Types.ObjectId(userId) });
    if (orderStatus === "PAID" || orderStatus === "SUCCESS") {
      if (!sub) {
        sub = new Subscription({
          userId:    mongoose.Types.ObjectId(userId),
          planId,
          orderId,
          amount:    selectedPlan.price,
          duration:  selectedPlan.label,
          status:    orderStatus,
          startDate: now,
          endDate:   newEnd
        });
      } else {
        sub.planId    = planId;
        sub.amount    = selectedPlan.price;
        sub.duration  = selectedPlan.label;
        sub.status    = orderStatus;
        sub.startDate = now;
        sub.endDate   = newEnd;
      }
      await sub.save();
      return res.status(200).json({ success: true, message: "Payment verified and subscription activated.", orderStatus, subscription: sub, data: response.data });
    }

    // payment not completed
    res.status(200).json({ success: false, message: "Payment not completed.", orderStatus, data: response.data });

  } catch (error) {
    console.error("Error in verifyPayment:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get current subscription status
const getSubscriptionStatus = async (req, res) => {
  try {
    const userId = req.user._id;
    let subscription = await Subscription.findOne({ userId: mongoose.Types.ObjectId(userId) });
    if (subscription && subscription.endDate && Date.now() > subscription.endDate.getTime()) {
      subscription.planId    = "free";
      subscription.startDate = new Date();
      subscription.endDate   = null;
      subscription.status    = "EXPIRED";
      subscription.duration  = "1-day";
      await subscription.save();
    }
    res.status(200).json({ success: true, hasActiveSubscription: subscription ? subscription.planId !== "free" : false, currentPlan: subscription ? subscription.planId : "free", subscription });
  } catch (error) {
    console.error("Error in getSubscriptionStatus:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createSubscriptionOrder,
  createOrder: createSubscriptionOrder, // alias
  verifyPayment,
  getSubscriptionStatus
};
