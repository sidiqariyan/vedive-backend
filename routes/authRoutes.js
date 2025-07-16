// routes/authRoutes.js - Cleaned up version without Passport
const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { authenticate } = require("../middleware/authMiddleware");
router.get('/form-data', (req, res) => {
  res.json({
    industries: VALID_INDUSTRIES,
    countries: VALID_COUNTRIES
  });
});
// Basic auth routes
router.post("/register", authController.register);
router.post("/resend-verification", authController.resendVerification);
router.get("/verify-email", authController.verifyEmail);
router.post("/login", authController.login);
router.post("/forgot-password", authController.forgotPassword);
router.post("/reset-password", authController.resetPassword);
router.get("/user", authenticate, authController.getUserData);
router.put("/update-password", authenticate, authController.updatePassword);

// Google OAuth routes (no passport needed)
router.get("/google", authController.googleAuth);
router.get("/google/callback", authController.googleCallback);

// Token verification
router.post("/verify-token", authController.verifyToken);

// Debug endpoint
router.get("/google/debug", (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID ? 'Set' : 'Not set',
    backendUrl: process.env.BACKEND_URL,
    frontendUrl: process.env.FRONTEND_URL,
    callbackUrl: `${process.env.BACKEND_URL}/api/auth/google/callback`
  });
});

module.exports = router;