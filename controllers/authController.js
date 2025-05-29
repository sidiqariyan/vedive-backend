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

    // Generate verification token with 15-minute expiry
    const verificationToken = generateToken({ _id: user._id }, "15m");
    user.verificationToken = verificationToken;
    user.verificationTokenExpires = Date.now() + 900000; // 15 minutes
    await user.save();

    // Log the token generation time
    console.log("Verification token generated at:", new Date().toISOString());

    // Build the verification URL
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
    await sendVerificationEmail(email, verificationUrl, name);

    // Respond with success message
    res.status(201).json({ 
      message: "User registered successfully. Please check your email to verify your account. The link will expire in 15 minutes.",
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

    // Generate new verification token with 15-minute expiry
    const verificationToken = generateToken({ _id: user._id }, "15m");
    user.verificationToken = verificationToken;
    user.verificationTokenExpires = Date.now() + 900000; // 15 minutes
    await user.save();

    // Log the token generation time
    console.log("Resend verification token generated at:", new Date().toISOString());

    // Build the verification URL
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
    await sendVerificationEmail(email, verificationUrl, user.name);

    res.status(200).json({ 
      message: "Verification email sent successfully. The link will expire in 15 minutes." 
    });
  } catch (error) {
    console.error("Resend Verification Error:", error);
    res.status(500).json({ error: "Failed to resend verification email" });
  }
};

/**
 * Verify Email
 * @route GET /api/auth/verify-email
 */
exports.verifyEmail = async (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).json({ error: "Token is required" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { clockTolerance: 60 });
    const user = await User.findOne({
      _id: decoded._id,
      verificationToken: token,
      verificationTokenExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ error: "Invalid or expired verification token" });
    }

    // Proceed with verification logic...
  } catch (jwtError) {
    if (jwtError.name === 'TokenExpiredError') {
      const payload = jwt.decode(token); // Decode without verification
      const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds
      const tokenExp = payload.exp; // Token's expiration time in seconds
      const timeDifference = tokenExp - currentTime; // Positive if token is still valid
      console.log(`Token expired: currentTime=${currentTime}, tokenExp=${tokenExp}, timeLeft=${timeDifference} seconds`);
      return res.status(400).json({
        error: "Verification link has expired. Please request a new one.",
        expired: true
      });
    }
    console.log(`Token verification error: ${jwtError.message}`);
    return res.status(400).json({ error: "Invalid token" });
  }
};
/**
 * Login User
 * @route POST /api/auth/login
 */
exports.login = async (req, res) => {
  try {
    const { emailOrUsername, password } = req.body;

    // Find user by email or username
    const user = await User.findOne({
      $or: [{ email: emailOrUsername }, { username: emailOrUsername }],
    });

    if (!user) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    // Check if password matches
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    // Check if user is verified
    if (!user.isVerified) {
      return res.status(400).json({ 
        error: "Please verify your email before logging in",
        needsVerification: true,
        email: user.email
      });
    }

    // Generate JWT token with 30-day expiry
    const token = generateToken({ _id: user._id }, '30d');
    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        _id: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ error: "Login failed" });
  }
};

/**
 * Forgot Password
 * @route POST /api/auth/forgot-password
 */
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: "User not found" });
    }

    // Generate reset password token with 1-hour expiry
    const resetToken = generateToken({ _id: user._id }, "1h");
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    await user.save();

    // Log the reset token generation time
    console.log("Reset password token generated at:", new Date().toISOString());

    // Send reset password email
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    await sendResetPasswordEmail(email, resetUrl);

    res.status(200).json({ 
      message: "Password reset link sent to your email. The link will expire in 1 hour." 
    });
  } catch (error) {
    console.error("Forgot Password Error:", error);
    res.status(500).json({ error: "Failed to send reset link" });
  }
};

/**
 * Reset Password
 * @route POST /api/auth/reset-password
 */
exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: "Token and new password are required" });
    }

    // Verify JWT token with clock tolerance
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET, { clockTolerance: 60 });
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(400).json({ 
          error: "Reset password link has expired. Please request a new one.",
          expired: true 
        });
      }
      return res.status(400).json({ error: "Invalid token" });
    }

    // Find user by reset token and check if token has not expired
    const user = await User.findOne({
      _id: decoded._id,
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() },
    });
    
    if (!user) {
      return res.status(400).json({ 
        error: "Reset password link has expired or is invalid. Please request a new one.",
        expired: true 
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update user's password and clear reset token fields
    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.status(200).json({ message: "Password reset successful" });
  } catch (error) {
    console.error("Password Reset Error:", error);
    res.status(500).json({ error: "Password reset failed" });
  }
};

/**
 * Fetch User Data
 * @route GET /api/auth/me
 */
exports.getUserData = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("name username email role");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (error) {
    console.error("Error fetching user data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/**
 * Update Password
 * @route POST /api/auth/update-password
 */
exports.updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Validate required fields
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Both currentPassword and newPassword are required" });
    }

    // Find the user by ID
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Compare the provided current password with the stored password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update the user's password
    user.password = hashedPassword;
    await user.save();

    res.json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("Error updating password:", error);
    res.status(500).json({ error: "Failed to update password" });
  }
};
