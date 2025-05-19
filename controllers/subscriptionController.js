// // controllers/subscriptionController.js
// const axios = require("axios");
// const mongoose = require("mongoose");
// const Subscription = require("../models/SubscriptionPlan");
// const { app_id, secret_key, environment } = require("../config/secret");
// const { v4: uuidv4 } = require("uuid");

// // Plan configurations: price (INR) and duration in milliseconds
// const planConfigs = {
//   free:    { price: 0,     duration: 0 },
//   daily:   { price: 99,    duration: 1  * 24 * 60 * 60 * 1000 },
//   weekly:  { price: 499,   duration: 7  * 24 * 60 * 60 * 1000 },
//   monthly: { price: 1999,  duration: 30 * 24 * 60 * 60 * 1000 },
// };

// const CASHFREE_BASE_URL = environment === "PROD"
//   ? "https://api.cashfree.com"
//   : "https://sandbox.cashfree.com";

// /**
//  * Create a new subscription order (or activate free plan immediately)
//  */
// async function createSubscriptionOrder(req, res, next) {
//   const session = await mongoose.startSession();
//   try {
//     session.startTransaction();

//     const userId = req.user?._id;
//     const { planId = "free", email, phone, name } = req.body;

//     // Validate plan
//     if (!planConfigs[planId]) {
//       return res.status(400).json({ success: false, message: "Invalid planId" });
//     }

//     const { price, duration } = planConfigs[planId];
//     const now = new Date();
//     const expiry = duration ? new Date(now.getTime() + duration) : null;

//     // Free plan: activate instantly
//     if (planId === "free") {
//       let sub = await Subscription.findOne({ userId }).session(session);
//       if (!sub) {
//         sub = new Subscription({ userId, plan: "free", startDate: now, endDate: null });
//       } else {
//         sub.plan = "free";
//         sub.startDate = now;
//         sub.endDate = null;
//       }
//       await sub.save({ session });
//       await session.commitTransaction();
//       return res.json({ success: true, message: "Free plan activated.", subscription: sub });
//     }

//     // Paid plan: require user info
//     if (!email || !phone || !name) {
//       return res.status(400).json({ success: false, message: "Missing customer details" });
//     }

//     // Build order identifiers
//     const orderId    = `ORID-${uuidv4()}`;
//     const customerId = `CID-${uuidv4()}`;

//     // Create Cashfree order
//     const payload = {
//       customer_details: {
//         customer_id: customerId,
//         customer_email: email,
//         customer_phone: phone,
//         customer_name: name,
//       },
//       order_meta: {
//         notify_url:    process.env.CASHFREE_NOTIFY_URL,
//         payment_methods: "cc,dc,upi",
//       },
//       order_amount:   price,
//       order_id:       orderId,
//       order_currency: "INR",
//       order_note:     `Subscription ${planId}`,
//     };

//     const response = await axios.post(
//       `${CASHFREE_BASE_URL}/pg/orders`,
//       payload,
//       {
//         headers: {
//           accept:           "application/json",
//           "x-api-version":  "2022-09-01",
//           "content-type":   "application/json",
//           "x-client-id":    app_id,
//           "x-client-secret": secret_key,
//         },
//       }
//     );

//     await session.commitTransaction();
//     return res.json({
//       success: true,
//       orderId,
//       paymentSessionId: response.data.payment_session_id,
//       data: response.data,
//     });
//   } catch (err) {
//     await session.abortTransaction();
//     console.error("createSubscriptionOrder error:", err.response?.data || err.message);
//     next(err);
//   } finally {
//     session.endSession();
//   }
// }

// /**
//  * Verify a payment and activate the subscription
//  */
// async function verifyPayment(req, res, next) {
//   try {
//     const userId = req.user?._id;
//     const { orderid } = req.params;
//     if (!userId) {
//       return res.status(401).json({ success: false, message: "Authentication required" });
//     }
//     if (!orderid) {
//       return res.status(400).json({ success: false, message: "Order ID missing" });
//     }

//     const url = `${CASHFREE_BASE_URL}/pg/orders/${encodeURIComponent(orderid)}`;
//     const response = await axios.get(url, {
//       headers: {
//         accept:           "application/json",
//         "x-api-version":  "2022-09-01",
//         "x-client-id":    app_id,
//         "x-client-secret": secret_key,
//       },
//     });

//     const { order_status: status, order_amount: amount } = response.data;
//     if (status !== "PAID" && status !== "SUCCESS") {
//       return res.status(200).json({ success: false, message: "Payment incomplete", status, data: response.data });
//     }

//     // Determine plan from amount
//     const planId = Object.entries(planConfigs).find(([, cfg]) => cfg.price === amount)?.[0] || "free";
//     const now = new Date();
//     const expiry = planConfigs[planId].duration
//       ? new Date(now.getTime() + planConfigs[planId].duration)
//       : null;

//     let sub = await Subscription.findOne({ userId });
//     if (!sub) {
//       sub = new Subscription({ userId, plan: planId, startDate: now, endDate: expiry });
//     } else {
//       sub.plan = planId;
//       sub.startDate = now;
//       sub.endDate = expiry;
//     }
//     await sub.save();

//     return res.json({
//       success: true,
//       message: "Subscription activated",
//       subscription: sub,
//       data: response.data,
//     });
//   } catch (err) {
//     console.error("verifyPayment error:", err.response?.data || err.message);
//     next(err);
//   }
// }

// /**
//  * Retrieve current subscription status
//  */
// async function getSubscriptionStatus(req, res, next) {
//   try {
//     const userId = req.user?._id;
//     if (!userId) {
//       return res.status(401).json({ success: false, message: "Authentication required" });
//     }

//     const now = new Date();
//     let sub = await Subscription.findOne({ userId });
//     if (!sub) {
//       sub = new Subscription({ userId, plan: "free", startDate: now, endDate: null });
//       await sub.save();
//     } else if (sub.endDate && now > sub.endDate) {
//       // Expired → downgrade to free
//       sub.plan = "free";
//       sub.startDate = now;
//       sub.endDate = null;
//       await sub.save();
//     }

//     return res.json({
//       success: true,
//       hasActiveSubscription: sub.plan !== "free",
//       currentPlan: sub.plan,
//       subscription: sub,
//     });
//   } catch (err) {
//     console.error("getSubscriptionStatus error:", err.message);
//     next(err);
//   }
// }

// module.exports = {
//   createSubscriptionOrder,
//   verifyPayment,
//   getSubscriptionStatus,
// };


const mongoose = require('mongoose');
const cashfree = require('../services/cashfreeClient');
const subscriptionService = require('../services/subscriptionService');
const { PLANS } = require('../config/plans');
const { frontend_url, notify_url } = require('../config/secret');

async function createSubscriptionOrder(req, res, next) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const userId = req.user._id;
    const { planId } = req.body;
    if (!PLANS[planId]) throw new Error('Invalid plan');

    const { subscription, orderId } = await subscriptionService.createPending(userId, planId, session);
    const cfResponse = await cashfree.createOrder({
      orderId,
      amount: PLANS[planId].price,
      currency: 'INR',
      customer: {
        id: userId,
        name: req.user.name,
        email: req.user.email,
        phone: req.user.phone,
      },
      returnUrl: `${frontend_url}/payment-success?order_id=${orderId}`,
      notifyUrl: notify_url,
    });

    await session.commitTransaction(); session.endSession();
    res.json({ success: true, orderId, paymentSessionId: cfResponse.payment_session_id, paymentLink: cfResponse.payment_link });
  } catch (err) {
    await session.abortTransaction(); session.endSession(); next(err);
  }
}

async function verifyPayment(req, res, next) {
  try {
    const { orderid } = req.params;
    const cfData = await cashfree.getOrder(orderid);
    if (cfData.order_status !== 'PAID') return res.status(400).json({ error: 'Payment incomplete' });

    const subscription = await subscriptionService.activate(orderid, new Date(cfData.order_date));
    res.json({ success: true, subscription });
  } catch (err) { next(err); }
}

async function webhookHandler(req, res, next) {
  try {
    const valid = subscriptionService.verifySignature(req.body, req.headers['x-webhook-signature']);
    if (!valid) return res.status(401).json({ error: 'Invalid signature' });
    await subscriptionService.handleEvent(req.body);
    res.json({ success: true });
  } catch (err) { next(err); }
}

async function getSubscriptionStatus(req, res, next) {
  try {
    const status = await subscriptionService.getStatus(req.user._id);
    res.json({ success: true, ...status });
  } catch (err) { next(err); }
}

module.exports = {
  createSubscriptionOrder,
  verifyPayment,
  webhookHandler,
  getSubscriptionStatus,
};
