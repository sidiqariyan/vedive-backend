const express = require('express');
const router = express.Router();
const {
  createSubscriptionOrder,
  verifyPayment,
  webhookHandler,
  getSubscriptionStatus
} = require('../controllers/subscriptionController');
const { authenticate } = require('../middleware/authMiddleware');

// Create subscription order
router.post('/create', authenticate, createSubscriptionOrder);

// Verify payment (client callback)
router.get('/verify/:orderid', authenticate, verifyPayment);

// Webhook endpoint for Cashfree server-to-server notifications
router.post('/webhook', express.raw({type: 'application/json'}), webhookHandler);

// Get current subscription status
router.get('/status', authenticate, getSubscriptionStatus);

module.exports = router;
