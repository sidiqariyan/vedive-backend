const User = require("../models/User");
const Subscription = require("../models/SubscriptionPlan");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const crypto = require("crypto");

// Constants for plans
const PLANS = [
  {
    id: "free",
    name: "Free",
    price: 0,
    durationDays: 1,
    features: {
      emailSending: true,
      emailScraping: false,
      whatsappSending: true,
      numberScraping: false,
      templates: false
    }
  },
  {
    id: "starter",
    name: "Starter",
    price: 49,
    durationDays: 1,
    features: {
      emailSending: true,
      emailScraping: true,
      whatsappSending: true,
      numberScraping: true,
      templates: true
    }
  },
  {
    id: "business",
    name: "Business",
    price: 199,
    durationDays: 7,
    features: {
      emailSending: true,
      emailScraping: true,
      whatsappSending: true,
      numberScraping: true,
      templates: true
    }
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: 699,
    durationDays: 30,
    features: {
      emailSending: true,
      emailScraping: true,
      whatsappSending: true,
      numberScraping: true,
      templates: true
    }
  }
];

// Get all available plans
exports.getPlans = async (req, res) => {
  try {
    res.status(200).json({ plans: PLANS });
  } catch (error) {
    console.error("Error fetching plans:", error);
    res.status(500).json({ error: "Failed to fetch plans" });
  }
};

// Get user's current subscription
exports.getUserSubscription = async (req, res) => {
  try {
    const userId = req.user._id;
    
    const subscription = await Subscription.findOne({ 
      userId: userId,
      status: "active",
      expiresAt: { $gt: new Date() }
    }).sort({ createdAt: -1 });
    
    if (!subscription) {
      return res.status(200).json({ 
        subscription: null, 
        currentPlan: "Free", 
        expiresAt: null 
      });
    }
    
    res.status(200).json({
      subscription: subscription,
      currentPlan: subscription.planName,
      expiresAt: subscription.expiresAt
    });
  } catch (error) {
    console.error("Error fetching user subscription:", error);
    res.status(500).json({ error: "Failed to fetch subscription details" });
  }
};

// Create order for plan purchase
exports.createOrder = async (req, res) => {
  try {
    const { planId } = req.body;
    const userId = req.user._id;
    
    // Validate plan
    const selectedPlan = PLANS.find(plan => plan.id === planId);
    if (!selectedPlan) {
      return res.status(400).json({ error: "Invalid plan selected" });
    }
    
    // Skip payment process for free plan
    if (selectedPlan.id === "free") {
      // Deactivate any existing subscriptions
      await Subscription.updateMany(
        { userId: userId, status: "active" },
        { $set: { status: "cancelled" } }
      );
      
      // Create new subscription record for free plan
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + selectedPlan.durationDays);
      
      const subscription = new Subscription({
        userId,
        planId: selectedPlan.id,
        planName: selectedPlan.name,
        orderId: `FREE-${uuidv4().substring(0, 8)}`,
        amount: 0,
        status: "active",
        paymentId: null,
        startedAt: new Date(),
        expiresAt
      });
      
      await subscription.save();
      
      // Update user's isPaidUser status
      await User.findByIdAndUpdate(userId, { isPaidUser: false });
      
      return res.status(200).json({
        success: true,
        message: "Free plan activated successfully",
        subscription: subscription
      });
    }
    
    // For paid plans, create Cashfree order
    const orderId = `VEDIVE-${uuidv4().substring(0, 8)}`;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    // Cashfree API integration
    const cashfreeBaseUrl = process.env.NODE_ENV === "production" 
      ? "https://api.cashfree.com/pg/orders" 
      : "https://sandbox.cashfree.com/pg/orders";
    
    const orderData = {
      order_id: orderId,
      order_amount: selectedPlan.price,
      order_currency: "INR",
      order_note: `Vedive ${selectedPlan.name} Plan Subscription`,
      customer_details: {
        customer_id: userId.toString(),
        customer_name: user.name || "Vedive User",
        customer_email: user.email,
        customer_phone: user.phone || "9999999999"
      },
      order_meta: {
        return_url: `${process.env.FRONTEND_URL || "http://localhost:5173"}/payment-status?order_id={order_id}&order_token={order_token}`,
        notify_url: `${process.env.BASE_URL || "http://localhost:3000"}/api/cashfree-webhook`
      }
    };
    
    // Make request to Cashfree API
    const response = await axios.post(cashfreeBaseUrl, orderData, {
      headers: {
        "x-api-version": "2022-09-01",
        "Content-Type": "application/json",
        "x-client-id": process.env.CASHFREE_APP_ID,
        "x-client-secret": process.env.CASHFREE_SECRET_KEY
      }
    });
    
    if (response.data && response.data.cf_order_id) {
      // Create a pending subscription in our database
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + selectedPlan.durationDays);
      
      const subscription = new Subscription({
        userId,
        planId: selectedPlan.id,
        planName: selectedPlan.name,
        orderId: orderId,
        cashfreeOrderId: response.data.cf_order_id,
        amount: selectedPlan.price,
        status: "pending",
        paymentId: null,
        startedAt: null,
        expiresAt: expiresAt
      });
      
      await subscription.save();
      
      return res.status(200).json({
        success: true,
        orderId: orderId,
        paymentLink: response.data.payment_link,
        paymentSessionId: response.data.payment_session_id,
        cashfreeOrderId: response.data.cf_order_id
      });
    } else {
      throw new Error("Failed to create payment order");
    }
    
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ error: "Failed to create order for payment" });
  }
};

// Verify payment callback from Cashfree
exports.verifyPayment = async (req, res) => {
  try {
    const { order_id, payment_id } = req.body;
    
    if (!order_id) {
      return res.status(400).json({ error: "Order ID is required" });
    }
    
    // Verify payment with Cashfree
    const cashfreeBaseUrl = process.env.NODE_ENV === "production"
      ? `https://api.cashfree.com/pg/orders/${order_id}`
      : `https://sandbox.cashfree.com/pg/orders/${order_id}`;
    
    const response = await axios.get(cashfreeBaseUrl, {
      headers: {
        "x-api-version": "2022-09-01",
        "Content-Type": "application/json",
        "x-client-id": process.env.CASHFREE_APP_ID,
        "x-client-secret": process.env.CASHFREE_SECRET_KEY
      }
    });
    
    if (response.data && response.data.order_status === "PAID") {
      // Find and update the subscription
      const subscription = await Subscription.findOne({ orderId: order_id });
      
      if (!subscription) {
        return res.status(404).json({ error: "Subscription not found" });
      }
      
      // Update subscription status
      subscription.status = "active";
      subscription.paymentId = payment_id || response.data.order_id;
      subscription.startedAt = new Date();
      await subscription.save();
      
      // Update user's isPaidUser status
      await User.findByIdAndUpdate(subscription.userId, { isPaidUser: true });
      
      return res.status(200).json({
        success: true,
        message: "Payment verified successfully",
        subscription: subscription
      });
    } else {
      return res.status(400).json({ 
        error: "Payment verification failed", 
        status: response.data?.order_status 
      });
    }
    
  } catch (error) {
    console.error("Error verifying payment:", error);
    res.status(500).json({ error: "Failed to verify payment" });
  }
};

// Webhook for Cashfree events
exports.checkSubscriptionStatus = async (req, res) => {
  try {
    const event = req.body;
    console.log("Cashfree webhook received:", JSON.stringify(event));
    
    // Verify webhook signature
    const webhookSignature = req.headers["x-webhook-signature"];
    if (webhookSignature && process.env.CASHFREE_SECRET_KEY) {
      const expectedSignature = crypto
        .createHmac("sha256", process.env.CASHFREE_SECRET_KEY)
        .update(JSON.stringify(req.body))
        .digest("hex");
      
      if (webhookSignature !== expectedSignature) {
        console.error("Invalid webhook signature");
        return res.status(401).json({ error: "Invalid signature" });
      }
    }
    
    // Handle different event types
    if (event.data && event.data.order && event.data.order.order_id) {
      const orderId = event.data.order.order_id;
      const subscription = await Subscription.findOne({ orderId: orderId });
      
      if (!subscription) {
        return res.status(404).json({ error: "Subscription not found" });
      }
      
      // Update subscription based on event type
      if (event.type === "ORDER_PAID" || event.type === "PAYMENT_SUCCESS") {
        subscription.status = "active";
        subscription.paymentId = event.data.payment?.payment_id || event.data.order.order_id;
        subscription.startedAt = new Date();
        await subscription.save();
        
        // Update user's isPaidUser status
        await User.findByIdAndUpdate(subscription.userId, { isPaidUser: true });
      } else if (
        event.type === "ORDER_FAILED" || 
        event.type === "PAYMENT_FAILED" || 
        event.type === "PAYMENT_DECLINED"
      ) {
        subscription.status = "failed";
        await subscription.save();
      } else if (event.type === "REFUND_SUCCESS") {
        subscription.status = "refunded";
        await subscription.save();
        
        // Check if user has other active subscriptions
        const activeSubscriptions = await Subscription.countDocuments({
          userId: subscription.userId,
          status: "active",
          expiresAt: { $gt: new Date() }
        });
        
        if (activeSubscriptions === 0) {
          // No active subscriptions, update user status
          await User.findByIdAndUpdate(subscription.userId, { isPaidUser: false });
        }
      }
    }
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error processing webhook:", error);
    res.status(500).json({ error: "Failed to process webhook" });
  }
};

// Cancel current subscription
exports.cancelSubscription = async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Find active subscription
    const subscription = await Subscription.findOne({
      userId: userId,
      status: "active",
      expiresAt: { $gt: new Date() }
    });
    
    if (!subscription) {
      return res.status(404).json({ error: "No active subscription found" });
    }
    
    // Update subscription status
    subscription.status = "cancelled";
    await subscription.save();
    
    // Update user's isPaidUser status
    await User.findByIdAndUpdate(userId, { isPaidUser: false });
    
    res.status(200).json({
      success: true,
      message: "Subscription cancelled successfully"
    });
  } catch (error) {
    console.error("Error cancelling subscription:", error);
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
};