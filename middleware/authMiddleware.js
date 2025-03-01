const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Authenticate Middleware
const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded._id) {
      return res.status(401).json({ error: "Invalid token payload" });
    }
    const user = await User.findById(decoded._id);
    if (!user) {
      return res.status(401).json({ error: "Invalid token" });
    }
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

// Subscription Access Middleware
const checkSubscription = async (req, res, next) => {
  const { user } = req;

  // Check if the user has an active subscription
  if (user.subscriptionStatus !== "active") {
    return res.status(403).json({ error: "Subscription required to access this resource" });
  }

  // Check if the subscription has expired
  const currentDate = new Date();
  if (user.subscriptionEnd && user.subscriptionEnd < currentDate) {
    user.subscriptionStatus = "inactive"; // Update status to inactive
    await user.save();
    return res.status(403).json({ error: "Subscription expired" });
  }

  next();
};

module.exports = { authenticate, checkSubscription };