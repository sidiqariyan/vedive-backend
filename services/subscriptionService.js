const mongoose = require('mongoose');
const Subscription = require('../models/SubscriptionPlan');
const { PLANS } = require('../config/plans');

module.exports = {
  async createPending(userId, planId, session) {
    const orderId = `ORID-${new mongoose.Types.ObjectId()}`;
    const now = new Date();
    const expiry = PLANS[planId].duration
      ? new Date(now.getTime() + PLANS[planId].duration)
      : null;

    // Fetch or initialize
    let sub = await Subscription.findOne({ userId }).session(session);
    if (!sub) sub = new Subscription({ userId });({ userId }).session(session);
    if (!sub) sub = new Subscription({ userId });

    sub.plan = 'pending';
    sub.startDate = now;
    sub.endDate = expiry;
    sub.orderId = orderId;
    await sub.save({ session });

    return { subscription: sub, orderId };
  },

  async activate(orderId, orderDate) {
    const record = await Subscription.findOne({ orderId });
    if (!record) throw new Error('Subscription record not found');

    const planId = record.planRequested || record.plan || 'free';
    const now = orderDate;
    const expiry = PLANS[planId].duration
      ? new Date(now.getTime() + PLANS[planId].duration)
      : null;

    record.plan = planId;
    record.startDate = now;
    record.endDate = expiry;
    record.orderId = undefined;
    await record.save();

    return record;
  },

  verifySignature: (body, signature) => {
    // TODO: implement webhook signature check
    return true;
  },

  async handleEvent(event) {
    if (event.order_status === 'PAID') {
      await this.activate(event.order_id, new Date(event.order_date));
    }
  },

  async getStatus(userId) {
    const now = new Date();
    let sub = await Subscription.findOne({ userId });
    if (!sub) return { plan: 'free', hasActive: false };
    if (sub.endDate && now > sub.endDate) {
      sub.plan = 'free';
      sub.startDate = now;
      sub.endDate = null;
      await sub.save();
    }
    return { plan: sub.plan, hasActive: sub.plan !== 'free' };
  }
};
