// middleware/adminMiddleware.js
const { authenticate } = require("./authMiddleware");

/**
 * Middleware to authorize based on user roles.
 * @param {...string} allowedRoles - list of roles allowed to access the route
 */
function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    // authenticate middleware should have already set req.user
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: "Forbidden: insufficient permissions" });
    }
    next();
  };
}

module.exports = { authorizeRoles };
