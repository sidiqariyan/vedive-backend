const mongoose = require('mongoose');
const cashfree = require('../services/cashfreeClient');
const Subscription = require('../models/SubscriptionPlan');
const { PLANS } = require('../config/plans');
const { frontendUrl, notifyUrl } = require('../config/secret');

async function createSubscriptionOrder(req, res, next) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { planId } = req.body;
    const userId = req.user._id;
    if (!PLANS[planId]) return res.status(400).json({ error: 'Invalid planId' });

    // create DB placeholder
    const plan = PLANS[planId];
    const now = new Date();
    const expiry = plan.durationMs ? new Date(now.getTime() + plan.durationMs) : null;
    const sub = await new Subscription({ userId, plan: 'pending', startDate: now, endDate: expiry }).save({ session });

    // call Cashfree
    const cf = await cashfree.createOrder({
      orderId: sub._id.toString(),
      amount: plan.price,
      currency: 'INR',
      customer: {
        id: userId.toString(), name: req.user.name, email: req.user.email, phone: req.user.phone
      },
      returnUrl: `${frontendUrl}/payment-success?order_id=${sub._id}`,
      notifyUrl,
    });

    // store order id
    sub.cashfreeOrderId = sub._id.toString();
    await sub.save({ session });

    await session.commitTransaction();
    res.json({ orderId: sub._id, paymentLink: cf.payment_link });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally { session.endSession(); }
}

async function verifyPayment(req, res, next) {
  try {
    const { orderid } = req.params;
    const cfData = await cashfree.getOrder(orderid);
    if (cfData.order_status !== 'PAID') return res.status(400).json({ error: 'Payment incomplete' });

    const sub = await Subscription.findById(orderid);
    sub.plan = sub.plan; // already set
    // all good
    await sub.save();

    res.json({ success: true, subscription: sub });
  } catch (err) { next(err); }
}

// webhook can be same as verify

async function getSubscriptionStatus(req, res, next) {
  try {
    const subs = await Subscription.find({ userId: req.user._id });
    res.json({ subscriptions: subs });
  } catch (err) { next(err); }
}

module.exports = { createSubscriptionOrder, verifyPayment, getSubscriptionStatus };
