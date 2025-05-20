const express = require('express');
const router = express.Router();
const { createSubscriptionOrder, verifyPayment, getSubscriptionStatus } = require('../controllers/subscriptionController');
const { authenticate } = require('../middleware/authMiddleware');

router.post('/create', authenticate, createSubscriptionOrder);
router.get('/verify/:orderid', authenticate, verifyPayment);
router.get('/status', authenticate, getSubscriptionStatus);

module.exports = router;
