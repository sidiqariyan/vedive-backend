// controllers/auth.js

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { sendVerificationEmail, sendResetPasswordEmail } = require("../utils/sendEmailToken");
require("dotenv").config();
bcrypt.setRandomFallback(crypto.randomBytes);

// Helper Function: Generate JWT Token with customizable expiry (default "1h")
const generateToken = (payload, expiresIn = "1h") => {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
};

/**
 * Register a new user
 * @route POST /api/auth/register
 */
exports.register = async (req, res) => {
  try {
    const { name, username, email, password } = req.body;

    // Validate required fields
    if (!name || !username || !email || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    // Ensure the password is a string
    if (typeof password !== "string") {
      console.error("Invalid password type:", password, typeof password);
      return res.status(400).json({ error: "Password must be a string" });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ error: "User with this email or username already exists" });
    }

    // Generate salt explicitly and hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create a new user
    const user = new User({
      name,
      username,
      email,
      password: hashedPassword,
    });

    // Save the user to the database
    await user.save();

    // Generate verification token with a 1-hour expiry
    const verificationToken = generateToken({ _id: user._id }, "1h");
    user.verificationToken = verificationToken;
    user.verificationTokenExpires = Date.now() + 3600000; // 1 hour
    await user.save();

    // Build the verification URL using the FRONTEND_URL environment variable
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
    await sendVerificationEmail(email, verificationUrl, name);

    // Respond with success message
    res.status(201).json({ 
      message: "User registered successfully. Please check your email to verify your account.",
      email: email 
    });
  } catch (error) {
    console.error("Registration Error:", error);
    res.status(500).json({ error: error.message || "Registration failed" });
  }
};

/**
 * Resend Verification Email
 * @route POST /api/auth/resend-verification
 */
exports.resendVerification = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: "User not found" });
    }

    // Check if user is already verified
    if (user.isVerified) {
      return res.status(400).json({ error: "Email is already verified" });
    }

    // Generate new verification token with 1-hour expiry
    const verificationToken = generateToken({ _id: user._id }, "1h");
    user.verificationToken = verificationToken;
    user.verificationTokenExpires = Date.now() + 3600000; // 1 hour
    await user.save();

    // Build the verification URL
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
    await sendVerificationEmail(email, verificationUrl, user.name);

    res.status(200).json({ message: "Verification email sent successfully" });
  } catch (error) {
    console.error("Resend Verification Error:", error);
    res.status(500).json({ error: "Failed to resend verification email" });
  }
};
