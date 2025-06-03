const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/User");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
require("dotenv").config();

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails[0].value;
    let user = await User.findOne({ $or: [{ email }, { googleId: profile.id }] });

    if (user) {
      if (!user.googleId) {
        user.googleId = profile.id;
        await user.save();
      }
      return done(null, user);
    }

    // Create new user
    user = new User({
      name: profile.displayName,
      email,
      googleId: profile.id,
      password: crypto.randomBytes(20).toString('hex'),
      authProvider: 'google',
      isVerified: true
    });
    
    await user.save();
    done(null, user);
  } catch (error) {
    done(error);
  }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error);
  }
});
