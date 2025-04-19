const axios = require("axios");
const { secret_key, app_id } = require("../config/secret");
const Subscription = require("../models/SubscriptionPlan");

// Map plan IDs to prices (fallback) and durations in milliseconds
const planPrices = {
  free: 0,
  starter: 49,
  business: 199,
  enterprise: 699,
};

// Fix: Ensure the plan durations correctly match what's shown in the frontend
const planDurations = {
  free: 1 * 24 * 60 * 60 * 1000,        // 1 day
  starter: 1 * 24 * 60 * 60 * 1000,      // 1 day (shown as "/1-day" in frontend)
  business: 7 * 24 * 60 * 60 * 1000,     // 1 week (shown as "/1-week" in frontend)
  enterprise: 30 * 24 * 60 * 60 * 1000,  // 1 month (shown as "/1-month" in frontend)
};

// POST /api/subscription/createOrder
const createSubscriptionOrder = async (req, res) => {
  try {
    const { planId, amount } = req.body;
    
    // Extract userId from either the request body or JWT token
    let userId = req.body.userId;
    if (!userId && req.user) {
      userId = req.user.id;
    }
    
    // Validate required fields
    if (!planId) {
      return res.status(400).json({ success: false, message: "Missing planId" });
    }
    if (!userId) {
      return res.status(400).json({ success: false, message: "Missing userId - please log in" });
    }
    
    // Extract user details
    const email = req.body.email || (req.user ? req.user.email : 'customer@example.com');
    const name = req.body.name || (req.user ? req.user.name : 'Customer');
    const phone = req.body.phone || '1234567890';

    const orderId = "ORID" + Date.now();
    const customerId = "CID" + userId;
    const orderAmount = amount || planPrices[planId] || 1;

    const options = {
      method: "POST",
      url: "https://sandbox.cashfree.com/pg/orders",
      headers: {
        accept: "application/json",
        "x-api-version": "2022-09-01",
        "content-type": "application/json",
        "x-client-id": app_id,
        "x-client-secret": secret_key
      },
      data: {
        customer_details: {
          customer_id: customerId,
          customer_email: email,
          customer_phone: phone,
          customer_name: name
        },
        order_meta: {
          notify_url: process.env.CASHFREE_NOTIFY_URL || "https://your-notify-url.com",
          payment_methods: "cc,dc,upi"
        },
        order_amount: orderAmount,
        order_id: orderId,
        order_currency: "INR",
        order_note: `Subscription order for plan ${planId} by user ${userId}`
      }
    };

    console.log(`Creating order for planId: ${planId}, userId: ${userId}`);
    const response = await axios.request(options);
    
    // Store order information in the database for verification later
    // You might want to add this functionality to track pending orders

    return res.status(200).json({
      success: true,
      orderId,
      planId,
      userId,
      paymentSessionId: response.data.payment_session_id,
      data: response.data
    });
  } catch (error) {
    console.error("Error in createSubscriptionOrder:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/subscription/verifyPayment/:orderid
const verifyPayment = async (req, res) => {
  const orderid = req.params.orderid;
  const orderToken = req.query.order_token;
  
  // Get userId from query params, JWT token, or request body
  let userId = req.query.userId;
  if (!userId && req.user) {
    userId = req.user.id;
  }
  
  // Initialize planId (will be extracted from Cashfree response if not provided)
  let planId = req.query.planId;

  try {
    console.log(`Verifying payment for orderId: ${orderid}, userId: ${userId}`);
    
    // Build the Cashfree API URL
    let url = `https://sandbox.cashfree.com/pg/orders/${orderid}`;
    if (orderToken) url += `?order_token=${orderToken}`;

    // Fetch order status from Cashfree
    const options = {
      method: "GET",
      url,
      headers: {
        accept: "application/json",
        "x-api-version": "2022-09-01",
        "x-client-id": app_id,
        "x-client-secret": secret_key
      }
    };
    
    const response = await axios.request(options);
    const orderStatus = response.data.order_status;
    console.log(`Order status from Cashfree: ${orderStatus}`);

    // Infer planId from the order_note if not provided
    if (!planId && response.data.order_note) {
      const match = response.data.order_note.match(/plan\s+(\w+)\s+by/i);
      if (match) planId = match[1].toLowerCase();
      console.log(`Extracted planId from order_note: ${planId}`);
    }
    
    if (!planId) {
      return res.status(400).json({ success: false, message: "planId is required" });
    }
    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    // Determine duration based on planId
    const planDuration = planDurations[planId];
    if (!planDuration) {
      return res.status(400).json({ success: false, message: `Invalid planId: ${planId}` });
    }

    // Activate subscription if payment successful
    if (orderStatus === "PAID" || orderStatus === "SUCCESS") {
      let sub = await Subscription.findOne({ userId });
      const start = new Date();
      const end = new Date(Date.now() + planDuration);
      
      console.log(`Activating ${planId} subscription for user ${userId} from ${start.toISOString()} until ${end.toISOString()}`);

      if (!sub) {
        sub = new Subscription({ userId, plan: planId, startDate: start, endDate: end });
      } else {
        sub.plan = planId;
        sub.startDate = start;
        sub.endDate = end;
      }
      await sub.save();

      return res.status(200).json({
        success: true,
        message: "Payment verified and subscription activated.",
        orderStatus,
        subscription: sub,
        data: response.data
      });
    }

    // Payment not completed
    return res.status(200).json({ success: false, message: "Payment not completed.", orderStatus, data: response.data });
  } catch (error) {
    console.error("Error in verifyPayment:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/subscription/status
const getSubscriptionStatus = async (req, res) => {
  try {
    // Get userId from JWT token or query params
    const userId = req.user?.id || req.query.userId;
    
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized - User ID not found" });
    }
    
    console.log(`Getting subscription status for userId: ${userId}`);
    let subscription = await Subscription.findOne({ userId });
    
    // Check if subscription has expired
    if (subscription && subscription.endDate) {
      const now = new Date();
      const endDate = new Date(subscription.endDate);
      
      console.log(`Subscription end date: ${endDate.toISOString()}, current date: ${now.toISOString()}`);
      
      if (now > endDate) {
        console.log(`Subscription expired for user ${userId}, reverting to free plan`);
        subscription.plan = "free";
        subscription.startDate = now;
        subscription.endDate = null;
        await subscription.save();
      }
    }
    
    return res.status(200).json({
      success: true,
      hasActiveSubscription: subscription ? subscription.plan !== "free" : false,
      currentPlan: subscription ? subscription.plan : "free",
      subscription
    });
  } catch (error) {
    console.error("Error in getSubscriptionStatus:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createSubscriptionOrder,
  verifyPayment,
  getSubscriptionStatus
};
