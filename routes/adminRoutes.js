const express = require("express");
const User = require("../models/User");
const { authenticate, authorize } = require("../middleware/authMiddleware"); // Import middleware
const router = express.Router();

// Debugging logs
console.log("Authenticate Middleware:", authenticate);
console.log("Authorize Middleware:", authorize);

// Middleware to ensure only admins can access these routes router.use(authenticate, authorize(["admin"]));


// Get all users (admin-only)
router.get("/users", async (req, res) => {
  try {
    const users = await User.find({}, "email role createdAt");
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch users", details: error.message });
  }
});

module.exports = router;