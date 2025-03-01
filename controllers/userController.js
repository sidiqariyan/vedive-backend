const User = require("../models/User");
const SubscriptionPlan = require("../models/SubscriptionPlan");

// Fetch User Data
exports.getUserData = async (req, res) => {
  try {
    const { userId } = req.params;

    // Find the user
    const user = await User.findById(userId).populate("subscriptionPlan").select("-password");
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.status(200).json(user);
  } catch (error) {
    console.error("Error fetching user data:", error);
    res.status(500).json({ error: "Failed to fetch user data" });
  }
};

// Update User Profile
exports.updateProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, username, email } = req.body;

    // Find the user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Update user details
    user.name = name || user.name;
    user.username = username || user.username;
    user.email = email || user.email;
    await user.save();

    res.status(200).json({ message: "Profile updated successfully", user });
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ error: "Failed to update profile" });
  }
};

// Update Subscription Plan
exports.updateSubscriptionPlan = async (req, res) => {
  try {
    const { userId, planId } = req.body;

    // Find the user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Find the new subscription plan
    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) {
      return res.status(404).json({ error: "Subscription plan not found" });
    }

    // Update user's subscription plan
    user.subscriptionPlan = plan._id;
    await user.save();

    res.status(200).json({
      message: "Subscription plan updated successfully",
      subscriptionPlan: plan.name,
    });
  } catch (error) {
    console.error("Error updating subscription plan:", error);
    res.status(500).json({ error: "Failed to update subscription plan" });
  }
};