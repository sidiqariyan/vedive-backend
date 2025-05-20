const mongoose = require('mongoose');
const cashfree = require('../services/cashfreeClient');
const Subscription = require('../models/Subscription');
const { PLANS } = require('../config/plans');
const { frontendUrl, notifyUrl } = require('../config/secret');
const { v4: uuidv4 } = require('uuid');

async function createSubscriptionOrder(req, res, next) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { planId } = req.body;
    const userId = req.user._id;
    if (!PLANS[planId]) return res.status(400).json({ error: 'Invalid planId' });

    // generate unique orderId
    const orderId = uuidv4();

    // create DB placeholder
    const plan = PLANS[planId];
    const now = new Date();
    const expiry = plan.durationMs ? new Date(now.getTime() + plan.durationMs) : null;
    const sub = new Subscription({
      userId,
      plan: 'pending',
      startDate: now,
      endDate: expiry,
      cashfreeOrderId: orderId,
    });
    await sub.save({ session });

    // call Cashfree API
    const cf = await cashfree.createOrder({
      orderId,
      amount: plan.price,
      currency: 'INR',
      customer: {
        id: userId.toString(),
        name: req.user.name,
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
    if (cfData.order_status !== 'PAID') return res.status(400).json({ error: 'Payment incomplete' });

    // activate in DB
    const sub = await Subscription.findOne({ cashfreeOrderId: orderid });
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });

    sub.plan = sub.plan; // or maintain previous planRequested if needed
    await sub.save();

    return res.json({ success: true, subscription: sub });
  } catch (err) {
    return next(err);
  }
}

async function getSubscriptionStatus(req, res, next) {
  try {
    const subs = await Subscription.find({ userId: req.user._id });
    return res.json({ subscriptions: subs });
  } catch (err) {
    return next(err);
  }
}

module.exports = { createSubscriptionOrder, verifyPayment, getSubscriptionStatus };

