const mongoose = require('mongoose');
const dayjs = require('dayjs');
const { getCashfreeClient } = require('../services/cashfreeClient');
const subscriptionService = require('../services/subscriptionService');
const { PLANS } = require('../config/plans');

/**
 * Create a subscription order and initiate payment
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware function
 * @returns {Promise<void>}
 */
async function createSubscriptionOrder(req, res, next) {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { planId } = req.body;
    
    if (!PLANS[planId]) {
      return res.status(400).json({ error: "Invalid plan" });
    }
    
    const plan = PLANS[planId];
    const userId = req.user._id;
    
    // Create a pending subscription record
    const subscription = await subscriptionService.createPending(userId, planId, session);
    
    // Get the frontend URL from env or use a default
    const frontendUrl = process.env.FRONTEND_URL || 'https://vedive.com';
    const backendUrl = process.env.BASE_URL || 'https://vedive.com:3000';
    
    // Initialize Cashfree order
    const cashfree = getCashfreeClient();
    const orderResponse = await cashfree.createOrder({
      orderId: subscription.cashfreeOrderId,
      amount: plan.price,
      currency: "INR",
      customer: {
        id: userId.toString(),
        name: req.user.name || '',
        email: req.user.email || '',
        phone: req.user.phone || "9999999999",
      },
      returnUrl: `${frontendUrl}/payment-status?order_id=${subscription.cashfreeOrderId}`,
      notifyUrl: `${backendUrl}/api/subscription/webhook`,
    });
    
    await session.commitTransaction();
    session.endSession();
    
    return res.json({
      success: true,
      orderId: subscription.cashfreeOrderId,
      paymentSessionId: orderResponse.payment_session_id,
      paymentLink: orderResponse.payment_link,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('Error creating subscription order:', err);
    
    return next(err);
  }
}

/**
 * Verify payment status for an order
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware function
 * @returns {Promise<void>}
 */
async function verifyPayment(req, res, next) {
  try {
    const { orderid } = req.params;
    const cashfree = getCashfreeClient();
    
    // Get order details from Cashfree
    const cfData = await cashfree.getOrder(orderid);
    
    if (cfData.order_status !== 'PAID') {
      return res.status(400).json({ 
        success: false,
        error: "Payment incomplete",
        status: cfData.order_status
      });
    }
    
    // Activate the subscription
    const subscription = await subscriptionService.activate(
      orderid, 
      dayjs(cfData.created_at || new Date())
    );
    
    return res.json({ 
      success: true, 
      subscription,
      plan: PLANS[subscription.plan]
    });
  } catch (err) {
    console.error('Error verifying payment:', err);
    return next(err);
  }
}

/**
 * Handle webhook notifications from Cashfree
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware function
 * @returns {Promise<void>}
 */
async function webhookHandler(req, res, next) {
  try {
    // Log the webhook payload for debugging
    console.log('Webhook received:', JSON.stringify(req.body, null, 2));
    
    // Verify the webhook signature
    const signature = req.headers['x-webhook-signature'] || req.headers['x-cashfree-signature'];
    const valid = subscriptionService.verifySignature(req.body, signature);
    
    if (!valid) {
      console.error('Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    // Process the event
    await subscriptionService.handleEvent(req.body);
    
    return res.json({ success: true });
  } catch (err) {
    console.error('Error handling webhook:', err);
    return next(err);
  }
}

/**
 * Get subscription status for the current user
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware function
 * @returns {Promise<void>}
 */
async function getSubscriptionStatus(req, res, next) {
  try {
    const userId = req.user._id;
    const status = await subscriptionService.getStatus(userId);
    
    return res.json({ 
      success: true, 
      ...status
    });
  } catch (err) {
    console.error('Error getting subscription status:', err);
    return next(err);
  }
}

module.exports = {
  createSubscriptionOrder,
  verifyPayment,
  webhookHandler,
  getSubscriptionStatus,
};
