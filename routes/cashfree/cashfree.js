// controllers/subscriptionController.js
const axios = require("axios");
const mongoose = require("mongoose");
const dayjs = require("dayjs");
const { getCashfreeClient } = require("../services/cashfreeClient");
const subscriptionService = require("../services/subscriptionService");
const { PLANS } = require("../config/plans");

// Create Order Handler
async function createSubscriptionOrder(req, res, next) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const userId = req.user._id;
    const { planId } = req.body;
    if (!PLANS[planId]) {
      return res.status(400).json({ error: "Invalid plan" });
    }

    const plan = PLANS[planId];
    // Create a pending subscription record
    const subscription = await subscriptionService.createPending(userId, planId, session);

    // Initialize Cashfree order
    const cashfree = getCashfreeClient();
    const orderResponse = await cashfree.createOrder({
      orderId: subscription.orderId,
      amount: plan.price,
      currency: "INR",
      customer: {
        id: userId,
        name: req.user.name,
        email: req.user.email,
        phone: req.user.phone,
      },
      returnUrl: `${process.env.FRONTEND_URL}/payment-status`,
      notifyUrl: `${process.env.BASE_URL}/api/subscription/webhook`,
    });

    await session.commitTransaction();
    session.endSession();

    return res.json({
      success: true,
      orderId: subscription.orderId,
      paymentSessionId: orderResponse.payment_session_id,
      paymentLink: orderResponse.payment_link,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
}

// Verify Payment Handler
async function verifyPayment(req, res, next) {
  try {
    const userId = req.user._id;
    const { orderId } = req.body;
    const cashfree = getCashfreeClient();
    const cfData = await cashfree.getOrder(orderId);

    if (cfData.order_status !== "PAID") {
      return res.status(400).json({ error: "Payment incomplete" });
    }

    const subscription = await subscriptionService.activate(orderId, dayjs(cfData.order_date), next);
    return res.json({ success: true, subscription });
  } catch (err) {
    next(err);
  }
}

// Webhook Handler
async function webhookHandler(req, res, next) {
  try {
    const valid = subscriptionService.verifySignature(req.body, req.headers['x-webhook-signature']);
    if (!valid) return res.status(401).json({ error: 'Invalid signature' });

    const event = req.body;
    await subscriptionService.handleEvent(event);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// Status Handler
async function getSubscriptionStatus(req, res, next) {
  try {
    const userId = req.user._id;
    const status = await subscriptionService.getStatus(userId);
    return res.json({ success: true, ...status });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createSubscriptionOrder,
  verifyPayment,
  webhookHandler,
  getSubscriptionStatus,
};

// Note: The service layer (services/subscriptionService.js) would encapsulate all DB interactions,
// PLANS come from a config file, and getCashfreeClient wraps axios with proper baseURL and headers.
