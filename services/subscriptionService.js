const { v4: uuidv4 } = require('uuid');
const dayjs = require('dayjs');
const Subscription = require('../models/Subscription');
const { PLANS } = require('../config/plans');
const { verifyWebhookSignature } = require('./cashfreeClient');

/**
 * Create a pending subscription
 * @param {string} userId - User ID
 * @param {string} planId - Plan ID from PLANS
 * @param {Object} session - Mongoose session for transaction
 * @returns {Promise<Object>} Created subscription
 */
async function createPending(userId, planId, session) {
  // Generate a unique order ID
  const orderId = uuidv4();
  console.log(`Generated orderId: ${orderId}`);
  
  // Clean up any existing pending subscriptions for this user
  const deleteResult = await Subscription.deleteMany({ 
    userId, 
    plan: 'pending' 
  }).session(session);
  console.log(`Deleted ${deleteResult.deletedCount} pending subscriptions`);
  
  // Create the new subscription record
  const now = new Date();
  const subscription = new Subscription({
    userId,
    plan: 'pending',
    intendedPlan: planId, // Store the intended plan for later activation
    startDate: now,
    endDate: null, // Will be set upon activation
    cashfreeOrderId: orderId,
    status: 'PENDING'
  });
  
  console.log(`Saving subscription with cashfreeOrderId: ${subscription.cashfreeOrderId}`);
  await subscription.save({ session });
  
  return subscription;
}

/**
 * Activate a subscription after payment is confirmed
 * @param {string} orderId - Order ID from Cashfree
 * @param {Date} paymentDate - Date of payment confirmation
 * @returns {Promise<Object>} Updated subscription
 */
async function activate(orderId, paymentDate) {
  const subscription = await Subscription.findOne({ cashfreeOrderId: orderId });
  
  if (!subscription) {
    throw new Error(`Subscription not found for order ID: ${orderId}`);
  }
  
  const planId = subscription.intendedPlan || 'starter'; // Default to starter if not specified
  const plan = PLANS[planId];
  
  if (!plan) {
    throw new Error(`Invalid plan: ${planId}`);
  }
  
  // Calculate expiry based on plan duration
  const now = paymentDate.toDate() || new Date();
  const expiry = plan.durationMs ? new Date(now.getTime() + plan.durationMs) : null;
  
  // Update subscription with active status and correct plan details
  subscription.plan = planId;
  subscription.startDate = now;
  subscription.endDate = expiry;
  subscription.status = 'ACTIVE';
  subscription.paymentDate = now;
  
  await subscription.save();
  return subscription;
}

/**
 * Get subscription status for a user
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Subscription status details
 */
async function getStatus(userId) {
  const subscription = await Subscription.findOne({ 
    userId,
    status: 'ACTIVE'
  }).sort({ createdAt: -1 });
  
  let currentPlan = 'free';
  let subscriptionEndDate = null;
  let isPaidUser = false;
  let remainingDays = 0;
  
  const now = Date.now();
  
  if (subscription && subscription.plan !== 'pending' && 
      (!subscription.endDate || subscription.endDate.getTime() > now)) {
    currentPlan = subscription.plan;
    subscriptionEndDate = subscription.endDate;
    isPaidUser = subscription.plan !== 'free';
    
    if (subscriptionEndDate) {
      remainingDays = Math.ceil((subscriptionEndDate - now) / (1000 * 60 * 60 * 24));
    }
  }
  
  return { 
    currentPlan, 
    subscriptionEndDate, 
    isPaidUser,
    remainingDays,
    features: PLANS[currentPlan]?.features || []
  };
}

/**
 * Verify Cashfree webhook signature
 * @param {Object} webhookBody - Request body
 * @param {string} signature - Signature from header
 * @returns {boolean} Whether signature is valid
 */
function verifySignature(webhookBody, signature) {
  return verifyWebhookSignature(webhookBody, signature);
}

/**
 * Handle webhook event from Cashfree
 * @param {Object} event - Webhook event data
 * @returns {Promise<void>}
 */
async function handleEvent(event) {
  try {
    // Process different event types
    if (event.event_type === 'ORDER_PAID') {
      const orderId = event.order_id;
      const paymentDate = dayjs(event.event_time);
      
      console.log(`Processing ORDER_PAID event for order: ${orderId}`);
      await activate(orderId, paymentDate);
      console.log(`Subscription activated for order: ${orderId}`);
    } else {
      console.log(`Unhandled event type: ${event.event_type}`);
    }
  } catch (error) {
    console.error('Error handling webhook event:', error);
    throw error;
  }
}

/**
 * Get subscription by order ID
 * @param {string} orderId - Cashfree order ID
 * @returns {Promise<Object>} Subscription document
 */
async function getSubscriptionByOrder(orderId) {
  return Subscription.findOne({ cashfreeOrderId: orderId });
}

module.exports = { 
  createPending,
  activate,
  getStatus,
  verifySignature,
  handleEvent,
  getSubscriptionByOrder 
};
