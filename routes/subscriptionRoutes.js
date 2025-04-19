const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware');

// Your subscription service or model import
const SubscriptionService = require('../services/subscriptionService');

// POST /api/subscription/createOrder
router.post('/createOrder', authenticate, async (req, res) => {
  // 1. Debug: log incoming payload
  console.log('⚙️  createOrder payload:', JSON.stringify(req.body, null, 2));

  // 2. Destructure required fields
  const { planId, couponCode, customerName } = req.body;

  // 3. Validate required fields with clear errors
  if (!planId) {
    return res.status(400).json({ error: 'Missing required field: planId' });
  }
  if (!customerName) {
    return res.status(400).json({ error: 'Missing required field: customerName' });
  }

  try {
    // 4. Call your business logic / service layer
    const order = await SubscriptionService.createOrder({
      userId: req.user._id,
      planId,
      couponCode,
      customerName,
    });

    // 5. Return success
    return res.status(200).json({ message: 'Order created', order });
  } catch (err) {
    console.error('❌ createOrder error:', err.stack || err);
    // In prod, you might omit `details`
    return res.status(500).json({ error: 'Failed to create order', details: err.message });
  }
});

module.exports = router;
