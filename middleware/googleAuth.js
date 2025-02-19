const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/User");
const jwt = require("jsonwebtoken");

// Serialize user into the session (not needed for JWT-based auth)
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialize user from the session (not needed for JWT-based auth)
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    console.error("Deserialize user error:", error);
    done(error, null);
  }
});

// Configure Google OAuth Strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:3000/api/auth/google/callback",
      scope: ["profile", "email"],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const existingUser = await User.findOne({ email: profile.emails[0].value });
        if (existingUser) {
          return done(null, existingUser);
        }
        const newUser = new User({
          name: profile.displayName,
          username: profile.emails[0].value.split("@")[0],
          email: profile.emails[0].value,
          password: null,
          role: "user",
        });
        await newUser.save();
        return done(null, newUser);
      } catch (error) {
        console.error("Google OAuth error:", error);
        return done(error, null);
      }
    }
  )
);

// Export a function to initialize Passport with the app
module.exports = (app) => {
  // Initiate Google OAuth flow
  app.get(
    "/api/auth/google",
    passport.authenticate("google", { scope: ["profile", "email"] })
  );

  // Handle Google OAuth callback
  app.get(
    "/api/auth/google/callback",
    passport.authenticate("google", { session: false }),
    (req, res) => {
      try {
        if (!req.user) {
          console.error("No user found in Google OAuth callback");
          return res.redirect(`${process.env.FRONTEND_URL || "http://localhost:5173/login"}`);
        }

        // Generate JWT token
        const token = jwt.sign({ userId: req.user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });

        // Redirect to frontend with token as query parameter
        res.redirect(`${process.env.FRONTEND_URL || "http://localhost:5173/dashboard"}?token=${token}`);
      } catch (error) {
        console.error("Google OAuth callback error:", error);
        res.redirect(`${process.env.FRONTEND_URL || "http://localhost:5173/login"}`);
      }
    }
  );
};