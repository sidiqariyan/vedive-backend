const User = require("../models/User");
const Subscription = require("../models/SubscriptionPlan");

/**
 * Checks for expired subscriptions and updates user status
 * This function should be called from a scheduler or cron job
 */
const checkExpiredSubscriptions = async () => {
  try {
    const currentDate = new Date();
    
    // Find expired subscriptions that are still active
    const expiredSubscriptions = await Subscription.find({
      status: "active",
      endDate: { $lt: currentDate }
    });
    
    console.log(`Found ${expiredSubscriptions.length} expired subscriptions`);
    
    // Update each subscription
    for (const subscription of expiredSubscriptions) {
      // Mark subscription as expired
      subscription.status = "expired";
      await subscription.save();
      
      // Check if user has any other active subscription
      const hasActiveSubscription = await Subscription.findOne({
        userId: subscription.userId,
        status: "active",
        endDate: { $gt: currentDate }
      });
      
      // If no active subscription, downgrade user to free
      if (!hasActiveSubscription) {
        await User.findByIdAndUpdate(subscription.userId, {
          isPaidUser: false,
          currentPlan: "Free",
          subscriptionEndDate: null
        });
        console.log(`User ${subscription.userId} downgraded to Free plan`);
      }
    }
    
    console.log("Subscription check completed");
  } catch (error) {
    console.error("Error checking expired subscriptions:", error);
  }
};

module.exports = { checkExpiredSubscriptions };