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
    const userId = req.user._id;
    const status = await subscriptionService.getStatus(userId);
    // Also fetch user fields
    const User = require('../models/User');
    const user = await User.findById(userId).select('currentPlan subscriptionEndDate isPaidUser');
    return res.json({ success: true, ...status, currentPlan: user.currentPlan, subscriptionEndDate: user.subscriptionEndDate, isPaidUser: user.isPaidUser });
    res.json({ success: true, ...status });
  } catch (err) { next(err); }
}

module.exports = { createSubscriptionOrder, verifyPayment, webhookHandler, getSubscriptionStatus };
