const express = require('express');
const router = express.Router();
const { 
  createSubscriptionOrder, 
  verifyPayment, 
  getSubscriptionStatus,
  webhookHandler
} = require('../controllers/subscriptionController');
const { authenticate } = require('../middleware/authMiddleware');

// Create a new subscription order
router.post('/create', authenticate, createSubscriptionOrder);

// Verify payment status for a specific order
router.get('/verify/:orderid', authenticate, verifyPayment);

// Get current subscription status
router.get('/status', authenticate, getSubscriptionStatus);

// Webhook endpoint for Cashfree callbacks
// Note: Webhook doesn't need auth middleware
router.post('/webhook', webhookHandler);

module.exports = router;
