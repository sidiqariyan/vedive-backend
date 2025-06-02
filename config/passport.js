// config/passport.js
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const jwt = require("jsonwebtoken");
const User = require("../models/User");
require("dotenv").config();

/**
 * GENERATE and sign your JWT (same as your existing generateToken helper).
 * We’ll reuse your generateToken from authController so that
 * when Google auth “succeeds,” we hand the user back a JWT.
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
      /*
        When Google redirects back, `profile` contains:
        - profile.id        → user’s unique Google ID (string)
        - profile.displayName
        - profile.emails[0].value
        - profile.photos[0].value
      */
      try {
        const existingUser = await User.findOne({ googleId: profile.id });

        if (existingUser) {
          // User already signed up with Google before → produce JWT
          const token = generateToken({ _id: existingUser._id });
          return done(null, { user: existingUser, token });
        }

        // If email already exists under “normal” registration, you could either:
        // 1. Link accounts by setting googleId on that existing user, or
        // 2. Throw an error ("User with that email already exists—please use normal login or link.")  
        // Below, we’ll assume we link automatically if email matches:
        const email = profile.emails[0].value.toLowerCase();
        const sameEmailUser = await User.findOne({ email });

        if (sameEmailUser) {
          // Link Google to existing account
          sameEmailUser.googleId = profile.id;
          sameEmailUser.photo = profile.photos?.[0]?.value || null;
          // Mark verified because Google gives us a verified email
          sameEmailUser.isVerified = true;
          await sameEmailUser.save();

          const token = generateToken({ _id: sameEmailUser._id });
          return done(null, { user: sameEmailUser, token });
        }

        // Otherwise, create brand-new user
        const newUser = new User({
          name: profile.displayName || "Google User",
          username: profile.emails[0].value.split("@")[0] + Date.now(), // guarantee unique
          email: email,
          password: crypto.randomBytes(16).toString("hex"), // dummy pass so that required field is satisfied
          googleId: profile.id,
          photo: profile.photos?.[0]?.value || null,
          isVerified: true,
        });

        await newUser.save();
        const token = generateToken({ _id: newUser._id });
        return done(null, { user: newUser, token });
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

// Serialize / deserialize just pass the user object since we’re not using sessions (JWT only):
passport.serializeUser((payload, done) => {
  // `payload` here is { user, token }
  done(null, payload); 
});
passport.deserializeUser((payload, done) => {
  done(null, payload);
});

module.exports = passport;
