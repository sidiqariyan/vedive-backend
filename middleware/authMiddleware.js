const jwt = require("jsonwebtoken");
const User = require("../models/User");

/**
 * Authenticate Middleware
 * Verifies the JWT token and attaches the authenticated user to the request object.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware function
 */


/**
 * Authenticate Middleware
 * Verifies the JWT token and attaches the authenticated user to the request object.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware function
 */
const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  // Check if token exists
  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Ensure the token contains a valid user ID
    if (!decoded._id) {
      return res.status(401).json({ error: "Invalid token payload" });
    }

    // Find the user in the database
    const user = await User.findById(decoded._id);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    // Attach the user object to the request
    req.user = user;

    // Check if the token is about to expire
    const currentTime = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp - currentTime < 60) {
      console.warn("Token is about to expire. Prompting user to log in again.");
      return res.status(401).json({ error: "Token expired. Please log in again." });
    }

    next();
  } catch (error) {
    console.error("Authentication Error:", error.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};


/**
 * Subscription Access Middleware
 * Ensures the user has an active subscription to access the requested resource.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware function
 */
// const checkSubscription = async (req, res, next) => {
//   const { user } = req;

//   // Check if the user has an active subscription
//   if (user.subscriptionStatus !== "active") {
//     return res.status(403).json({ error: "Subscription required to access this resource" });
//   }

//   // Check if the subscription has expired
//   const currentDate = new Date();
//   if (user.subscriptionEnd && user.subscriptionEnd < currentDate) {
//     // Update subscription status asynchronously to avoid blocking the request
//     User.findByIdAndUpdate(user._id, { subscriptionStatus: "inactive" }, { new: true })
//       .catch((err) => console.error("Error updating subscription status:", err));

//     return res.status(403).json({ error: "Subscription expired" });
//   }

//   next();
// };

// Export both middlewares
module.exports = { authenticate };