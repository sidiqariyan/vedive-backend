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
        console.log("Google OAuth Profile:", {
          id: profile.id,
          email: profile.emails?.[0]?.value,
          name: profile.displayName
        });

        // Check if user already exists with Google ID
        const existingUser = await User.findOne({ googleId: profile.id });
        
        if (existingUser) {
          console.log("Found existing Google user:", existingUser.email);
          // User already signed up with Google → generate JWT
          const token = generateToken({ _id: existingUser._id });
          return done(null, { user: existingUser, token });
        }

        // Check if email already exists under normal registration
        const email = profile.emails?.[0]?.value?.toLowerCase();
        if (!email) {
          return done(new Error("No email provided by Google"), null);
        }

        const sameEmailUser = await User.findOne({ email });
        
        if (sameEmailUser) {
          console.log("Linking Google to existing account:", email);
          // Link Google to existing account
          sameEmailUser.googleId = profile.id;
          sameEmailUser.photo = profile.photos?.[0]?.value || null;
          sameEmailUser.isVerified = true; // Google gives us verified email
          sameEmailUser.authProvider = 'google';
          await sameEmailUser.save();
          
          const token = generateToken({ _id: sameEmailUser._id });
          return done(null, { user: sameEmailUser, token });
        }

        // Create brand-new user
        console.log("Creating new Google user:", email);
        
        // Generate unique username
        let baseUsername = email.split("@")[0];
        let username = baseUsername;
        let counter = 1;
        
        // Ensure username is unique
        while (await User.findOne({ username })) {
          username = `${baseUsername}${counter}`;
          counter++;
        }

        const newUser = new User({
          name: profile.displayName || "Google User",
          username: username,
          email: email,
          password: crypto.randomBytes(16).toString("hex"), // dummy password for Google users
          googleId: profile.id,
          photo: profile.photos?.[0]?.value || null,
          isVerified: true,
          authProvider: 'google'
        });
        
        await newUser.save();
        console.log("Created new Google user:", newUser.email);
        
        const token = generateToken({ _id: newUser._id });
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
