const User = require("../models/User");
const SubscriptionPlan = require("../models/SubscriptionPlan");

const checkExpiredSubscriptions = async () => {
  try {
    const now = new Date();
    const expiredUsers = await User.find({
      subscriptionStatus: "active",
      subscriptionEndDate: { $lt: now },
    });

    for (const user of expiredUsers) {
      const freePlan = await SubscriptionPlan.findOne({ name: "Free" });
      user.subscriptionPlan = freePlan._id;
      user.currentPlan = freePlan.name;
      user.subscriptionStatus = "inactive";
      user.isPaidUser = false;
      user.subscriptionStart = null;
      user.subscriptionEndDate = null;
      await user.save();
    }
    console.log(`Checked and updated ${expiredUsers.length} expired subscriptions`);
  } catch (error) {
    console.error("Error checking expired subscriptions:", error);
  }
};

module.exports = { checkExpiredSubscriptions };
