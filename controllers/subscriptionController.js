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

// 1) Create an order on Cashfree
const createSubscriptionOrder = async (req, res) => {
  try {
    const { planId, email, phone, name, userId } = req.body;

    // Validate userId
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid or missing userId"
      });
    }

    const orderId    = "ORID" + Date.now();
    const customerId = "CID"  + Date.now();
    const selectedPlan = planDetails[planId] || { price: 1 };
    const orderAmount  = selectedPlan.price;

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
          customer_email: email || "customer@example.com",
          customer_phone: phone || "1234567890",
          customer_name:  name  || "Customer Name"
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
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};


// 2) Verify payment & activate/update subscription
const verifyPayment = async (req, res) => {
  try {
    const orderid    = req.params.orderid;
    const orderToken = req.query.order_token;
    const userId     = req.query.userId;
    const planId     = req.query.planId || "starter";

    // Validate userId
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid or missing userId"
      });
    }

    const selectedPlan = planDetails[planId] || {
      price: 1,
      duration: 1 * 24 * 60 * 60 * 1000,
      label: "1-day"
    };

    // Fetch order status from Cashfree
    let url = `https://sandbox.cashfree.com/pg/orders/${orderid}`;
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

    if (orderStatus === "PAID" || orderStatus === "SUCCESS") {
      // Try to find existing subscription
      let sub = await Subscription.findOne({
        userId: mongoose.Types.ObjectId(userId)
      });

      const now       = new Date();
      const newEnd    = new Date(now.getTime() + selectedPlan.duration);

      if (!sub) {
        sub = new Subscription({
          userId:    mongoose.Types.ObjectId(userId),
          planId,
          orderId:   orderid,
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
    console.error("Error in verifyPayment:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};


// 3) Get current subscription status (and auto‑expire if past endDate)
const getSubscriptionStatus = async (req, res) => {
  try {
    const userId = req.query.userId;

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid or missing userId"
      });
    }

    const oid = mongoose.Types.ObjectId(userId);
    let subscription = await Subscription.findOne({ userId: oid });

    // If expired, downgrade to "free"
    if (subscription && subscription.endDate && Date.now() > subscription.endDate.getTime()) {
      subscription.planId    = "free";
      subscription.startDate = new Date();
      subscription.endDate   = null;
      subscription.status    = "EXPIRED";
      subscription.duration  = "1-day";
      await subscription.save();
    }

    res.status(200).json({
      success: true,
      hasActiveSubscription: subscription ? subscription.planId !== "free" : false,
      currentPlan:           subscription ? subscription.planId : "free",
      subscription
    });

  } catch (error) {
    console.error("Error in getSubscriptionStatus:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};


module.exports = {
  createSubscriptionOrder,
  verifyPayment,
  getSubscriptionStatus
};
