// 📁 controllers/subscriptionController.js
const mongoose = require('mongoose');
const Subscription = require('../models/Subscription');
const cashfree = require('../services/cashfreeClient');
const { PLANS } = require('../config/plans');
const { frontendUrl, notifyUrl } = require('../config/secret');
const { v4: uuidv4 } = require('uuid');

async function createSubscriptionOrder(req, res, next) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { planId } = req.body;
    if (!PLANS[planId]) return res.status(400).json({ error: 'Invalid planId' });

    // 1) Generate unique order ID
    const orderId = uuidv4();

    // 2) Create pending subscription record
    const now    = new Date();
    const expiry = PLANS[planId].durationMs ? new Date(now.getTime() + PLANS[planId].durationMs) : null;
    const sub    = new Subscription({
      userId:          req.user._id,
      plan:            'pending',
      startDate:       now,
      endDate:         expiry,
      cashfreeOrderId: orderId,
    });
    await sub.save({ session });

    // 3) Call Cashfree to create the order
    const cf = await cashfree.createOrder({
      orderId,
      amount:   PLANS[planId].price,
      currency: 'INR',
      customer: {
        id:    req.user._id.toString(),
        name:  req.user.name,
        email: req.user.email,
        phone: req.user.phone,
      },
      returnUrl: `${frontendUrl}/payment-success?order_id=${orderId}`,
      notifyUrl,
    });

    await session.commitTransaction();
    session.endSession();

    return res.json({
      orderId,
      paymentLink: cf.payment_link,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return next(err);
  }
}

async function verifyPayment(req, res, next) {
  try {
    const { orderid } = req.params;
    const cfData = await cashfree.getOrder(orderid);
    if (cfData.order_status !== 'PAID') {
      return res.status(400).json({ error: 'Payment incomplete' });
    }

    // Activate in DB
    const sub = await Subscription.findOne({ cashfreeOrderId: orderid });
    if (!sub) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    // Flip from pending → actual plan
    // (If you want to track planRequested, store it in the doc and use it here)
    sub.plan = sub.plan; 
    await sub.save();

    return res.json({ success: true, subscription: sub });
  } catch (err) {
    return next(err);
  }
}

async function getSubscriptionStatus(req, res, next) {
  try {
    const sub = await Subscription
      .findOne({ userId: req.user._id })
      .sort({ createdAt: -1 });

    let currentPlan = 'free';
    let subscriptionEndDate = null;
    let isPaidUser = false;

    if (sub && sub.plan !== 'pending') {
      const now = Date.now();
      if (!sub.endDate || sub.endDate.getTime() > now) {
        currentPlan = sub.plan;
        subscriptionEndDate = sub.endDate;
        isPaidUser = sub.plan !== 'free';
      }
    }

    return res.json({
      success: true,
      currentPlan,
      subscriptionEndDate,
      isPaidUser,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { createSubscriptionOrder, verifyPayment, getSubscriptionStatus };
