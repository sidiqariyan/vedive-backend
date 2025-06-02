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

// 1) Kick off Google OAuth
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

// 2) Google will redirect here after consent:
//    passport strategy’s callback will run, then `authController.googleCallback` should send back the JWT.
router.get(
  "/google/callback",
  passport.authenticate("google", { session: false, failureRedirect: "/auth/google/failure" }),
  (req, res) => {
    // If we get here, authentication was successful.
    // `req.user` is what we passed in `done(null, payload)` in passport config:
    //    payload = { user: <UserDoc>, token: <jwt-string> }
    const { token } = req.user;
    // Now, redirect the client to the frontend with the token as a query param:
    // e.g. https://your-frontend-url.com/oauth2/redirect?token=ABC123
    res.redirect(`${process.env.FRONTEND_URL}/oauth2/redirect?token=${token}`);
  }
);

// Optional: handle failure
router.get("/google/failure", (req, res) => {
  return res.status(401).json({ error: "Google Authentication Failed" });
});
router.get("/google", (req, res, next) => {
  console.log("Google OAuth callback URL:", process.env.GOOGLE_CALLBACK_URL);
  next();
}, passport.authenticate("google", { scope: ["profile", "email"] }));

module.exports = router;
