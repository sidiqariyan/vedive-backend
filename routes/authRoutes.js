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
// routes/authRoutes.js - Updated Google OAuth callback
router.get(
  "/google/callback",
  (req, res, next) => {
    console.log("=== GOOGLE CALLBACK RECEIVED ===");
    console.log("Query params:", req.query);
    console.log("User-Agent:", req.get('User-Agent'));
    console.log("===============================");
    
    // Check for OAuth errors in query params
    if (req.query.error) {
      console.error("OAuth error in callback:", req.query.error);
      return res.redirect(`${process.env.FRONTEND_URL}/oauth2/redirect?error=google_oauth_failed`);
    }
    
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
      
      // Build the redirect URL with token
      const redirectUrl = `${process.env.FRONTEND_URL}/oauth2/redirect?token=${encodeURIComponent(token)}`;
      console.log("Redirecting to:", redirectUrl);
      
      // Redirect to frontend with token
      res.redirect(redirectUrl);
    } catch (error) {
      console.error("Error in Google callback:", error);
      res.redirect(`${process.env.FRONTEND_URL}/oauth2/redirect?error=callback_error`);
    }
  }
);

// Enhanced token verification endpoint
router.post("/verify-token", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: "Token required" });
    }

    console.log("Verifying token for OAuth user");
    
    const jwt = require("jsonwebtoken");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded._id).select('-password');
    
    if (!user) {
      console.error("User not found for token");
      return res.status(404).json({ error: "User not found" });
    }

    console.log("Token verification successful for user:", user.email);

    res.json({
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        username: user.username,
        isVerified: user.isVerified,
        authProvider: user.authProvider || 'email',
        photo: user.photo
      }
    });
  } catch (error) {
    console.error("Token verification error:", error);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: "Token expired" });
    }
    res.status(401).json({ error: "Invalid token" });
  }
});
module.exports = router;
