const User = require("../models/User");
const Order = require("../models/Order");
const axios = require("axios");
const { secret_key, app_id } = require("../config/secret");

// Helper function to calculate subscription end date based on plan duration
const calculateEndDate = (duration) => {
  const now = new Date();
  
  if (duration === "1-day") {
    return new Date(now.setDate(now.getDate() + 1));
  } else if (duration === "1-week") {
    return new Date(now.setDate(now.getDate() + 7));
  } else if (duration === "1-month") {
    return new Date(now.setMonth(now.getMonth() + 1));
  }
  
  // Default to 1 day if duration is unspecified
  return new Date(now.setDate(now.getDate() + 1));
};

// Create a new subscription order
const createOrder = async (req, res) => {
  try {
    const { planId, amount, duration } = req.body;
    const userId = req.user._id;
    
    if (!planId || !amount) {
      return res.status(400).json({ 
        success: false, 
        error: "Plan ID and amount are required" 
      });
    }
    
    const orderId = `ORDER_${Date.now()}_${userId.toString().slice(-6)}`;
    const customerId = `CUST_${userId.toString()}`;
    
    // Ensure amount is a valid number
    const orderAmount = parseFloat(amount);
    if (isNaN(orderAmount)) {
      return res.status(400).json({
        success: false,
        error: "Invalid amount"
      });
    }
    
    // Create order in Cashfree
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
          customer_email: req.user.email || "customer@example.com",
          customer_phone: req.user.phone || "1234567890",
          customer_name: req.user.name || "Customer Name"
        },
        order_meta: {
          notify_url: process.env.CASHFREE_NOTIFY_URL || "https://your-notify-url.com",
          payment_methods: "cc,dc,upi"
        },
        order_amount: orderAmount,
        order_id: orderId,
        order_currency: "INR",
        order_note: `Subscription for plan ${planId} (${duration})`
      }
    };
    
    const response = await axios.request(options);
    
    // Save order to database
    const newOrder = new Order({
      userId,
      orderId,
      amount: orderAmount,
      planId,
      duration,
      status: "CREATED",
      paymentSessionId: response.data.payment_session_id
    });
    
    await newOrder.save();
    
    res.status(200).json({
      success: true,
      orderId,
      paymentSessionId: response.data.payment_session_id,
      data: response.data
    });
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to create subscription order"
    });
  }
};

// Verify payment and activate subscription
const verifyPayment = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user._id;
    
    // Check if order exists
    const order = await Order.findOne({ orderId });
    if (!order) {
      return res.status(404).json({
        success: false,
        error: "Order not found"
      });
    }
    
    // Verify payment status with Cashfree
    const options = {
      method: "GET",
      url: `https://sandbox.cashfree.com/pg/orders/${orderId}`,
      headers: {
        accept: "application/json",
        "x-api-version": "2022-09-01",
        "x-client-id": app_id,
        "x-client-secret": secret_key
      }
    };
    
    const response = await axios.request(options);
    const paymentStatus = response.data.order_status;
    
    // Update order status
    order.status = paymentStatus;
    await order.save();
    
    // If payment is successful, activate subscription
    if (paymentStatus === "PAID") {
      // Update user subscription details
      const endDate = calculateEndDate(order.duration);
      
      await User.findByIdAndUpdate(userId, {
        isPaidUser: true,
        currentPlan: order.planId,
        subscriptionEndDate: endDate,
        subscriptionDetails: {
          orderId: orderId,
          planId: order.planId,
          startDate: new Date(),
          endDate: endDate,
          amount: order.amount,
          duration: order.duration,
          status: "active"
        }
      });
      
      return res.status(200).json({
        success: true,
        message: "Payment successful and subscription activated",
        paymentStatus,
        subscription: {
          planId: order.planId,
          startDate: new Date(),
          endDate: endDate,
          duration: order.duration
        }
      });
    }
    
    res.status(200).json({
      success: paymentStatus === "PAID",
      message: paymentStatus === "PAID" ? "Payment successful" : "Payment not completed",
      paymentStatus
    });
  } catch (error) {
    console.error("Error verifying payment:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to verify payment"
    });
  }
};

// Get current subscription status
const getSubscriptionStatus = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }
    
    const now = new Date();
    const hasActiveSubscription = user.isPaidUser && user.subscriptionEndDate && new Date(user.subscriptionEndDate) > now;
    
    res.status(200).json({
      success: true,
      hasActiveSubscription,
      currentPlan: hasActiveSubscription ? user.currentPlan : "free",
      subscription: hasActiveSubscription ? {
        planId: user.currentPlan,
        startDate: user.subscriptionDetails?.startDate,
        endDate: user.subscriptionEndDate,
        duration: user.subscriptionDetails?.duration
      } : null
    });
  } catch (error) {
    console.error("Error getting subscription status:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get subscription status"
    });
  }
};

module.exports = {
  createOrder,
  verifyPayment,
  getSubscriptionStatus
};
