// config/passport.js
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
require("dotenv").config();

/**
 * Generate JWT token (same as your existing generateToken helper)
 */
const generateToken = (payload, expiresIn = "30d") => {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
};

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Check if user already exists with Google ID
        const existingUser = await User.findOne({ googleId: profile.id });
        if (existingUser) {
          // User already signed up with Google → generate JWT
          const token = generateToken({ _id: existingUser._id }); // Fixed: _id not *id
          return done(null, { user: existingUser, token });
        }

        // Check if email already exists under normal registration
        const email = profile.emails[0].value.toLowerCase();
        const sameEmailUser = await User.findOne({ email });
        
        if (sameEmailUser) {
          // Link Google to existing account
          sameEmailUser.googleId = profile.id;
          sameEmailUser.photo = profile.photos?.[0]?.value || null;
          // Mark verified because Google gives us a verified email
          sameEmailUser.isVerified = true;
          await sameEmailUser.save();
          
          const token = generateToken({ _id: sameEmailUser._id }); // Fixed: _id not *id
          return done(null, { user: sameEmailUser, token });
        }

        // Create brand-new user
        const newUser = new User({
          name: profile.displayName || "Google User",
          username: profile.emails[0].value.split("@")[0] + Date.now(), // guarantee unique
          email: email,
          password: crypto.randomBytes(16).toString("hex"), // dummy password
          googleId: profile.id,
          photo: profile.photos?.[0]?.value || null,
          isVerified: true,
        });
        
        await newUser.save();
        const token = generateToken({ _id: newUser._id }); // Fixed: _id not *id
        return done(null, { user: newUser, token });
        
      } catch (err) {
        console.error("Google OAuth Error:", err);
        return done(err, null);
      }
    }
  )
);

// Serialize/deserialize for session-less JWT approach
passport.serializeUser((payload, done) => {
  done(null, payload); 
});

passport.deserializeUser((payload, done) => {
  done(null, payload);
});

module.exports = passport;
