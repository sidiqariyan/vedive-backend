const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const axios = require("axios");
const { authenticate } = require("../../middleware/authMiddleware");
const User = require("../../models/User");
const Subscription = require("../../models/SubscriptionPlan");
const { v4: uuidv4 } = require("uuid");

// Cashfree API configuration
const CASHFREE_BASE_URL = process.env.NODE_ENV === "production" 
  ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";

// Plan configuration - should match the frontend plans
const PLANS = {
  starter: {
    id: "starter",
    name: "Starter",
    price: 49,
    durationDays: 1,
    features: ["mail_sending", "mail_scraping", "whatsapp_sending", "number_scraping", "templates"]
  },
  business: {
    id: "business",
    name: "Business",
    price: 199,
    durationDays: 7,
    features: ["mail_sending", "mail_scraping", "whatsapp_sending", "number_scraping", "templates"]
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    price: 699,
    durationDays: 30,
    features: ["mail_sending", "mail_scraping", "whatsapp_sending", "number_scraping", "templates"]
  }
};

// Create an order with Cashfree
router.post("/create-order", authenticate, async (req, res) => {
  try {
    const { planId } = req.body;
    const userId = req.user._id;

    // Validate plan
    if (!PLANS[planId]) {
      return res.status(400).json({ error: "Invalid plan selected" });
    }

    const plan = PLANS[planId];
    const orderId = `order_${uuidv4()}`;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Create order payload
    const orderPayload = {
      order_id: orderId,
      order_amount: plan.price,
      order_currency: "INR",
      order_note: `Subscription for ${plan.name} Plan`,
      customer_details: {
        customer_id: userId,
        customer_name: user.name || "Customer",
        customer_email: user.email,
        customer_phone: user.phone || "9999999999" // Fallback if phone not available
      },
      order_meta: {
        return_url: `${process.env.FRONTEND_URL || "http://localhost:5173"}/payment-status?order_id={order_id}&order_token={order_token}`,
        notify_url: `${process.env.BASE_URL || "http://localhost:3000"}/api/cashfree-webhook`
      }
    };

    // Get Cashfree token for authorization
    const authResponse = await axios.post(
      `${CASHFREE_BASE_URL}/orders`,
      orderPayload,
      {
        headers: {
          "x-api-version": "2022-09-01",
          "Content-Type": "application/json",
          "x-client-id": process.env.CASHFREE_APP_ID,
          "x-client-secret": process.env.CASHFREE_SECRET_KEY
        }
      }
    );

    // Create a subscription record in pending status
    const newSubscription = new Subscription({
      userId,
      planId,
      planName: plan.name,
      amount: plan.price,
      durationDays: plan.durationDays,
      orderId,
      paymentId: null,
      features: plan.features,
      status: "pending",
      startDate: null,
      endDate: null
    });

    await newSubscription.save();

    // Return the payment link to frontend
    return res.status(200).json({
      success: true,
      order_id: orderId,
      payment_session_id: authResponse.data.payment_session_id,
      payment_link: authResponse.data.payment_link
    });
  } catch (error) {
    console.error("Error creating order:", error.response?.data || error.message);
    return res.status(500).json({
      error: "Failed to create payment order",
      details: error.message
    });
  }
});

// Verify payment status
router.post("/verify-payment", authenticate, async (req, res) => {
  try {
    const { orderId, orderToken } = req.body;
    const userId = req.user._id;

    // Verify the payment with Cashfree
    const verifyResponse = await axios.get(
      `${CASHFREE_BASE_URL}/orders/${orderId}`,
      {
        headers: {
          "x-api-version": "2022-09-01",
          "Content-Type": "application/json",
          "x-client-id": process.env.CASHFREE_APP_ID,
          "x-client-secret": process.env.CASHFREE_SECRET_KEY
        }
      }
    );

    const paymentData = verifyResponse.data;

    if (paymentData.order_status === "PAID") {
      // Update subscription status
      const subscription = await Subscription.findOne({ 
        userId, 
        orderId 
      });

      if (!subscription) {
        return res.status(404).json({ error: "Subscription not found" });
      }

      // Calculate dates
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + subscription.durationDays);

      // Update subscription
      subscription.status = "active";
      subscription.paymentId = paymentData.cf_payment_id || paymentData.payment_id;
      subscription.startDate = startDate;
      subscription.endDate = endDate;
      await subscription.save();

      // Update user to premium
      await User.findByIdAndUpdate(userId, { 
        isPaidUser: true,
        currentPlan: subscription.planName,
        subscriptionEndDate: endDate
      });

      return res.status(200).json({
        success: true,
        subscription: subscription
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Payment not completed",
        status: paymentData.order_status
      });
    }
  } catch (error) {
    console.error("Error verifying payment:", error.response?.data || error.message);
    return res.status(500).json({
      error: "Failed to verify payment",
      details: error.message
    });
  }
});

// Cashfree webhook for payment notifications
router.post("/cashfree-webhook", async (req, res) => {
  try {
    const event = req.body;
    
    // Verify webhook signature
    const postData = JSON.stringify(req.body);
    const signature = req.headers["x-webhook-signature"] || "";
    
    // Create the expected signature
    const expectedSignature = crypto
      .createHmac("sha256", process.env.CASHFREE_SECRET_KEY)
      .update(postData)
      .digest("base64");
    
    // Validate signature
    if (signature !== expectedSignature) {
      console.error("Invalid webhook signature");
      return res.status(401).send({ error: "Invalid signature" });
    }

    // Process the event based on type
    if (event.data && event.data.order && event.event_type === "ORDER_PAID") {
      const orderId = event.data.order.order_id;
      const paymentId = event.data.payment.cf_payment_id;
      
      // Find subscription
      const subscription = await Subscription.findOne({ orderId });
      
      if (subscription) {
        // Calculate dates
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + subscription.durationDays);
        
        // Update subscription
        subscription.status = "active";
        subscription.paymentId = paymentId;
        subscription.startDate = startDate;
        subscription.endDate = endDate;
        await subscription.save();
        
        // Update user to premium
        await User.findByIdAndUpdate(subscription.userId, { 
          isPaidUser: true,
          currentPlan: subscription.planName,
          subscriptionEndDate: endDate
        });
        
        console.log(`Subscription activated for order ${orderId}`);
      }
    }
    
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Get current user subscription status
router.get("/subscription-status", authenticate, async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Find active subscription
    const subscription = await Subscription.findOne({
      userId,
      status: "active",
      endDate: { $gt: new Date() }
    }).sort({ endDate: -1 });
    
    // Get user data
    const user = await User.findById(userId);
    
    if (!subscription) {
      return res.status(200).json({
        hasActiveSubscription: false,
        isPaidUser: false,
        currentPlan: "Free",
        user
      });
    }
    
    return res.status(200).json({
      hasActiveSubscription: true,
      isPaidUser: true,
      subscription,
      currentPlan: subscription.planName,
      user
    });
  } catch (error) {
    console.error("Error checking subscription:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Get subscription history
router.get("/subscription-history", authenticate, async (req, res) => {
  try {
    const userId = req.user._id;
    
    const subscriptions = await Subscription.find({ userId })
      .sort({ createdAt: -1 })
      .limit(10);
    
    return res.status(200).json({ subscriptions });
  } catch (error) {
    console.error("Error fetching subscription history:", error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;