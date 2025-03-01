const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/authMiddleware");
const userController = require("../controllers/userController");

/**
 * Fetch User Data
 * GET /api/users/:userId
 */
router.get("/:userId", authenticate, userController.getUserData);

/**
 * Update User Profile
 * PUT /api/users/:userId/profile
 */
router.put("/:userId/profile", authenticate, userController.updateProfile);

/**
 * Update Subscription Plan
 * PUT /api/users/:userId/subscription
 */
router.put("/:userId/subscription", authenticate, userController.updateSubscriptionPlan);

module.exports = router;