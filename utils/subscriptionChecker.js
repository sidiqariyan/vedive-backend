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
    
    for (const subscription of expiredSubscriptions) {
      // Mark subscription as expired
      subscription.status = "expired";
      await subscription.save();
      
      // Fetch the user for this subscription
      const user = await User.findById(subscription.userId);
      if (!user) {
        console.warn(`User ${subscription.userId} not found, skipping downgrade`);
        continue;
      }
      
      // Skip downgrading admins — their membership is always active
      if (user.role === "admin") {
        console.log(`Skipping downgrade for admin user ${user._id}`);
        continue;
      }
      
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
