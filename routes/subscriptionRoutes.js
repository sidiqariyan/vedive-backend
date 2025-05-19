const express = require('express');
const router = express.Router();
const {
  createSubscriptionOrder,
  verifyPayment,
  webhookHandler,
  getSubscriptionStatus
} = require('../controllers/subscriptionController');
const { authenticate } = require('../middleware/auth');

router.post('/create', authenticate, createSubscriptionOrder);
router.get('/verify/:orderid', authenticate, verifyPayment);
router.post('/webhook', webhookHandler);
router.get('/status', authenticate, getSubscriptionStatus);

module.exports = router;

