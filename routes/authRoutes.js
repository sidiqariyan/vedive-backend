
// routes/authRoutes.js
const express = require("express");
const router = express.Router();
const passport = require("../config/passport");
const authController = require("../controllers/authController");
const { authenticate } = require("../middleware/authMiddleware");
const User = require("../models/User");

// Your existing routes:
router.post("/register", authController.register);
router.post("/resend-verification", authController.resendVerification);
router.get("/verify-email", authController.verifyEmail);
router.post("/login", authController.login);
router.post("/forgot-password", authController.forgotPassword);
router.post("/reset-password", authController.resetPassword);
router.get("/user", authenticate, authController.getUserData);
router.put("/update-password", authenticate, authController.updatePassword);

// ─────────────────────────────────────────────────────────
// NEW: Google OAuth flow
// ─────────────────────────────────────────────────────────

// Debug endpoint to check Google OAuth configuration
router.get("/google/debug", (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID ? 'Set' : 'Not set',
    googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL,
    serverUrl: req.protocol + '://' + req.get('host'),
    fullCallbackUrl: req.protocol + '://' + req.get('host') + '/api/auth/google/callback'
  });
});

// 1) Kick off Google OAuth
router.get(
  "/google",
  (req, res, next) => {
    console.log("=== GOOGLE OAUTH INITIATED ===");
    console.log("Callback URL from env:", process.env.GOOGLE_CALLBACK_URL);
    console.log("Server host:", req.get('host'));
    console.log("Protocol:", req.protocol);
    console.log("Full URL:", req.protocol + '://' + req.get('host') + req.originalUrl);
    console.log("============================");
    next();
  },
  passport.authenticate("google", { scope: ["profile", "email"] })
);

// 2) Google OAuth callback
router.get(
  "/google/callback",
  passport.authenticate("google", { 
    session: false, 
    failureRedirect: ${process.env.FRONTEND_URL}/login?error=google_auth_failed 
  }),
  (req, res) => {
    try {
      console.log("=== GOOGLE OAUTH CALLBACK ===");
      console.log("User authenticated:", !!req.user);
      
      if (!req.user || !req.user.token) {
        console.error("No user or token in callback");
        return res.redirect(${process.env.FRONTEND_URL}/login?error=authentication_failed);
      }

      const { token } = req.user;
      console.log("Redirecting with token to:", ${process.env.FRONTEND_URL}/oauth2/redirect?token=${token});
      
      // Redirect to frontend with token
      res.redirect(${process.env.FRONTEND_URL}/oauth2/redirect?token=${token});
    } catch (error) {
      console.error("Error in Google callback:", error);
      res.redirect(${process.env.FRONTEND_URL}/login?error=callback_error);
    }
  }
);

// Optional: handle Google OAuth failure
router.get("/google/failure", (req, res) => {
  console.log("Google OAuth failed");
  res.redirect(${process.env.FRONTEND_URL}/login?error=google_oauth_failed);
});

// Test endpoint to verify Google user creation
router.get("/test-google-users", async (req, res) => {
  try {
    const googleUsers = await User.find({ googleId: { $exists: true } })
      .select('name email googleId photo authProvider createdAt')
      .limit(10);
    
    res.json({
      success: true,
      count: googleUsers.length,
      users: googleUsers
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
