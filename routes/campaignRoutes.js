// ./routes/campaignRoutes.js
const express = require("express");
const router = express.Router();
const Campaign = require("../models/Campaign");

// Fetch all campaigns for the logged-in user
router.get("/", async (req, res) => {
  try {
    console.log("Fetching campaigns for user:", req.user?._id); // Debugging log

    if (!req.user) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const campaigns = await Campaign.find({ userId: req.user._id }); // Fetch campaigns for the logged-in user
    res.json(campaigns);
  } catch (error) {
    console.error("Error fetching campaigns:", error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;