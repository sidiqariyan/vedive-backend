const Subscription = require('../models/Subscription');
const { PLANS } = require('../config/plans');

async function createSubscription(userId, planId) {
  const plan = PLANS[planId];
  const now = new Date();
  const expiry = plan.durationMs ? new Date(now.getTime() + plan.durationMs) : null;
  const sub = new Subscription({ userId, plan: planId, startDate: now, endDate: expiry });
  return sub.save();
}

async function getSubscriptionByOrder(orderId) {
  return Subscription.findOne({ cashfreeOrderId: orderId });
}

module.exports = { createSubscription, getSubscriptionByOrder }
