const express = require("express");
const router = express.Router();
const { authenticate, checkSubscription } = require("../middleware/authMiddleware");
const toolController = require("../controllers/toolController");

// Fetch All Tools (Accessible Based on Subscription)
router.get("/tools", authenticate, checkSubscription, toolController.getAllTools);

// Fetch Tool Details by ID
router.get("/tools/:toolId", authenticate, checkSubscription, toolController.getToolById);

module.exports = router;