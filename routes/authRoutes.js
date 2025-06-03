// routes/authRoutes.js - Fixed version with better error handling
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
// IMPROVED: Google OAuth flow with better error handling
// ─────────────────────────────────────────────────────────

// Debug endpoint to check Google OAuth configuration
router.get("/google/debug", (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID ? 'Set' : 'Not set',
    googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL,
    serverUrl: req.protocol + '://' + req.get('host'),
    fullCallbackUrl: req.protocol + '://' + req.get('host') + '/api/auth/google/callback',
    frontendUrl: process.env.FRONTEND_URL
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
    console.log("User-Agent:", req.get('User-Agent'));
    console.log("============================");
    next();
  },
  passport.authenticate("google", { 
    scope: ["profile", "email"],
    prompt: "select_account" // Force account selection
  })
);

// 2) Google OAuth callback - Improved error handling
router.get(
  "/google/callback",
  (req, res, next) => {
    console.log("=== GOOGLE CALLBACK RECEIVED ===");
    console.log("Query params:", req.query);
    console.log("===============================");
    
    passport.authenticate("google", { 
      session: false,
      failureRedirect: `${process.env.FRONTEND_URL}/oauth2/redirect?error=google_auth_failed`
    })(req, res, next);
  },
  (req, res) => {
    try {
      console.log("=== GOOGLE OAUTH CALLBACK SUCCESS ===");
      console.log("User authenticated:", !!req.user);
      console.log("User object keys:", req.user ? Object.keys(req.user) : 'No user');
      
      if (!req.user) {
        console.error("No user object in callback");
        return res.redirect(`${process.env.FRONTEND_URL}/oauth2/redirect?error=authentication_failed`);
      }

      if (!req.user.token) {
        console.error("No token in user object");
        return res.redirect(`${process.env.FRONTEND_URL}/oauth2/redirect?error=token_missing`);
      }

      const { token, user } = req.user;
      console.log("User ID:", user._id);
      console.log("User email:", user.email);
      console.log("Token generated successfully");
      console.log("Redirecting to:", `${process.env.FRONTEND_URL}/oauth2/redirect?token=${token.substring(0, 20)}...`);
      
      // Redirect to frontend with token
      res.redirect(`${process.env.FRONTEND_URL}/oauth2/redirect?token=${token}`);
    } catch (error) {
      console.error("Error in Google callback:", error);
      res.redirect(`${process.env.FRONTEND_URL}/oauth2/redirect?error=callback_error`);
    }
  }
);

// Handle authentication errors
router.get("/google/error", (req, res) => {
  console.log("Google OAuth error endpoint hit");
  res.redirect(`${process.env.FRONTEND_URL}/oauth2/redirect?error=google_oauth_failed`);
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

// Test endpoint to verify JWT token
router.post("/verify-token", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: "Token required" });
    }

    const jwt = require("jsonwebtoken");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded._id).select('-password');
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        username: user.username,
        isVerified: user.isVerified,
        authProvider: user.authProvider
      }
    });
  } catch (error) {
    console.error("Token verification error:", error);
    res.status(401).json({ error: "Invalid token" });
  }
});

module.exports = router;
