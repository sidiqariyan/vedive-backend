// ./routes/dashboardRoutes.js
const express = require("express");
const router = express.Router();
const User = require("../models/User");

// Protected Dashboard Route
router.get("/", async (req, res) => {
  try {
    console.log("Fetching user data for dashboard:", req.user?._id); // Debugging log

    if (!req.user) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const user = await User.findById(req.user._id).select("name email username"); // Fetch only necessary fields
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ message: "Welcome to the dashboard!", user });
  } catch (error) {
    console.error("Error fetching user data:", error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;