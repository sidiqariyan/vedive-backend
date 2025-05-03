const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { authenticate } = require("../middleware/authMiddleware");
const User = require("../models/User");

// Routes
router.post("/register", authController.register);
router.get("/verify-email", authController.verifyEmail);
router.post("/login", authController.login);
router.post("/forgot-password", authController.forgotPassword);
router.post("/reset-password", authController.resetPassword);
router.get("/user", authenticate, authController.getUserData);
router.put("/update-password", authenticate, authController.updatePassword);
router.get("/user", authenticate, authController.getUserData);
module.exports = router
