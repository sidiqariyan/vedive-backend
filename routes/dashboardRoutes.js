const express = require("express");
const router = express.Router();
const Campaign = require("../models/Campaign");
const { authenticate } = require("../middleware/authMiddleware");

// Fetch user-specific dashboard data
router.get("/dashboard", authenticate, async (req, res) => {
  try {
    // Get the authenticated user's ID from the middleware
    const userId = req.user._id;
    console.log("Fetching campaigns for user:", userId);

    // Query campaigns for the logged-in user only
    const campaigns = await Campaign.find({ userId });

    console.log("Campaigns found:", campaigns);

    // Return the user and their campaigns in the response
    res.json({
      message: "Dashboard data retrieved successfully",
      user: req.user,
      campaigns: campaigns || [],
    });
  } catch (error) {
    console.error("Error fetching dashboard data:", error.message);
    res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
});

module.exports = router;
