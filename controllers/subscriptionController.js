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

    const orderId = uuidv4();
    const now = new Date();
    const plan = PLANS[planId];
    const expiry = plan.durationMs ? new Date(now.getTime() + plan.durationMs) : null;

    const sub = new Subscription({
      userId:          req.user._id,
      plan:            'pending',
      startDate:       now,
      endDate:         expiry,
      cashfreeOrderId: orderId,
    });
    await sub.save({ session });

    const cf = await cashfree.createOrder({
      orderId,
      amount: plan.price,
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

    return res.json({ orderId, paymentLink: cf.payment_link });
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

    const sub = await Subscription.findOne({ cashfreeOrderId: orderid });
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });

    sub.plan = sub.plan; // preserve actual plan
    await sub.save();

    return res.json({ success: true, subscription: sub });
  } catch (err) {
    return next(err);
  }
}

async function getSubscriptionStatus(req, res, next) {
  try {
    const sub = await Subscription.findOne({ userId: req.user._id }).sort({ createdAt: -1 });

    let currentPlan = 'free';
    let subscriptionEndDate = null;
    let isPaidUser = false;
    const now = Date.now();

    if (sub && sub.plan !== 'pending' && (!sub.endDate || sub.endDate.getTime() > now)) {
      currentPlan = sub.plan;
      subscriptionEndDate = sub.endDate;
      isPaidUser = sub.plan !== 'free';
    }

    return res.json({ success: true, currentPlan, subscriptionEndDate, isPaidUser });
  } catch (err) {
    return next(err);
  }
}

module.exports = { createSubscriptionOrder, verifyPayment, getSubscriptionStatus };

