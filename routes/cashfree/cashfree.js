const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const axios = require("axios");
const { authenticate } = require("../../middleware/authMiddleware");
const User = require("../../models/User");
const Subscription = require("../../models/SubscriptionPlan");
const { v4: uuidv4 } = require("uuid");
const { validatePaymentRequest } = require("../../middleware/paymentValidation");

// Cashfree configuration
const CASHFREE_CONFIG = {
  baseURL: process.env.NODE_ENV === "production" 
    ? "https://api.cashfree.com/pg" 
    : "https://sandbox.cashfree.com/pg",
  headers: {
    "x-api-version": "2022-09-01",
    "Content-Type": "application/json",
    "x-client-id": process.env.CASHFREE_APP_ID,
    "x-client-secret": process.env.CASHFREE_SECRET_KEY
  }
};

// Enhanced plan configuration with validation
const validatePlans = () => {
  const requiredFields = ['id', 'name', 'price', 'durationDays', 'features'];
  Object.values(PLANS).forEach(plan => {
    requiredFields.forEach(field => {
      if (!plan[field]) throw new Error(`Missing ${field} in plan configuration`);
    });
  });
};

const PLANS = {
  starter: {
    id: "starter",
    name: "Starter",
    price: 49,
    durationDays: 1,
    features: ["mail_sending", "mail_scraping", "whatsapp_sending", "number_scraping", "templates"]
  },
  // Other plans...
};

validatePlans(); // Validate at startup

// Payment Order Creation
router.post("/payment/create-order", 
  authenticate,
  validatePaymentRequest,
  async (req, res) => {
    try {
      const { planId } = req.body;
      const user = await User.findById(req.user._id);
      
      if (!user) return res.status(404).json({ error: "User not found" });
      if (!PLANS[planId]) return res.status(400).json({ error: "Invalid plan" });

      const orderId = `order_${uuidv4()}`;
      const plan = PLANS[planId];

      const orderPayload = {
        order_id: orderId,
        order_amount: plan.price,
        order_currency: "INR",
        customer_details: {
          customer_id: user._id.toString(),
          customer_name: user.name,
          customer_email: user.email,
          customer_phone: user.phone || "9999999999"
        },
        order_meta: {
          return_url: `${process.env.FRONTEND_URL}/payment-status?order_id={order_id}`,
          notify_url: `${process.env.BASE_URL}/api/payment/webhook`
        }
      };

      const { data } = await axios.post(
        `${CASHFREE_CONFIG.baseURL}/orders`,
        orderPayload,
        { headers: CASHFREE_CONFIG.headers }
      );

      await Subscription.create({
        userId: user._id,
        planId,
        ...plan,
        orderId,
        status: "pending"
      });

      res.json({
        success: true,
        orderId,
        paymentSessionId: data.payment_session_id,
        paymentLink: data.payment_link
      });

    } catch (error) {
      console.error(`Order Creation Error: ${error.message}`);
      res.status(500).json({
        error: "Payment initialization failed",
        details: process.env.NODE_ENV === "development" ? error.message : null
      });
    }
  }
);

// Payment Verification
router.post("/payment/verify", 
  authenticate,
  async (req, res) => {
    try {
      const { orderId } = req.body;
      const user = req.user;
      
      const [subscription, cfResponse] = await Promise.all([
        Subscription.findOne({ orderId, userId: user._id }),
        axios.get(`${CASHFREE_CONFIG.baseURL}/orders/${orderId}`, {
          headers: CASHFREE_CONFIG.headers
        })
      ]);

      if (!subscription) return res.status(404).json({ error: "Subscription not found" });
      
      const paymentData = cfResponse.data;
      if (paymentData.order_status !== "PAID") {
        return handleFailedPayment(res, subscription, paymentData.order_status);
      }

      const { startDate, endDate } = calculateSubscriptionDates(subscription.durationDays);
      
      await Promise.all([
        Subscription.findByIdAndUpdate(subscription._id, {
          status: "active",
          paymentId: paymentData.cf_payment_id,
          startDate,
          endDate
        }),
        User.findByIdAndUpdate(user._id, {
          isPaidUser: true,
          currentPlan: subscription.planName,
          subscriptionEndDate: endDate
        })
      ]);

      res.json({ success: true, message: "Payment verified successfully" });

    } catch (error) {
      console.error(`Verification Error: ${error.message}`);
      res.status(500).json({
        error: "Payment verification failed",
        details: process.env.NODE_ENV === "development" ? error.message : null
      });
    }
  }
);

// Enhanced Webhook Handler
router.post("/payment/webhook", 
  async (req, res) => {
    try {
      const signature = req.headers["x-webhook-signature"];
      if (!verifyWebhookSignature(req.body, signature)) {
        return res.status(401).json({ error: "Invalid signature" });
      }

      const event = req.body;
      const { order_id, cf_payment_id } = event.data || {};
      
      switch (event.event_type) {
        case "ORDER_PAID":
          await handleSuccessfulPayment(order_id, cf_payment_id);
          break;
        case "ORDER_FAILED":
          await handleFailedOrder(order_id);
          break;
        case "REFUND_PROCESSED":
          await handleRefund(order_id);
          break;
      }

      res.json({ success: true });

    } catch (error) {
      console.error(`Webhook Error: ${error.message}`);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  }
);

// Helper functions
const verifyWebhookSignature = (body, signature) => {
  const generatedSignature = crypto
    .createHmac("sha256", process.env.CASHFREE_SECRET_KEY)
    .update(JSON.stringify(body))
    .digest("base64");

  return signature === generatedSignature;
};

const calculateSubscriptionDates = (durationDays) => {
  const startDate = new Date();
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + durationDays);
  return { startDate, endDate };
};

const handleFailedPayment = async (res, subscription, status) => {
  if (subscription.status === "pending") {
    await Subscription.findByIdAndUpdate(subscription._id, { status: "failed" });
  }
  return res.status(400).json({
    success: false,
    error: "Payment incomplete",
    status
  });
};

// Additional subscription management endpoints remain similar but would include:
// - Better error handling
// - Transactional database operations
// - Proper status code handling
// - Rate limiting for sensitive endpoints

module.exports = router;