// utils/sendEmailToken.js

const nodemailer = require("nodemailer");
require("dotenv").config();

// Create transporter
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT),                // ensure numeric port
  secure: process.env.EMAIL_SECURE === "true",         // true for 465, false for 587
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    // NOTE: set to false to allow self-signed certs; remove in prod!
    rejectUnauthorized: false
  }
});

// Verify connection configuration on startup
transporter.verify((err, success) => {
  if (err) {
    console.error("🚨 SMTP connection error:", err);
  } else {
    console.log("✅ SMTP server is ready to send messages");
  }
});

// Beautiful HTML template for verification email
const getVerificationEmailTemplate = (name, verificationUrl) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Verify Your Email - Vedive</title>
  <style>/* …your existing CSS… */</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">VEDIVE</div>
      <div class="header-subtitle">Welcome to our community</div>
    </div>
    <div class="content">
      <div class="welcome-text">Hello ${name}! 👋</div>
      <div class="message">
        Thank you for joining Vedive! Please verify your email by clicking below.
      </div>
      <a href="${verificationUrl}" class="verify-button">
        ✓ Verify My Email Address
      </a>
      <div class="expire-notice">
        ⏰ <strong>Notice:</strong> This link expires in 15 minutes.
      </div>
      <div class="security-notice">
        🔒 If you didn’t sign up, ignore this email.
      </div>
      <div class="alternative-link">
        <div class="alternative-text">
          Trouble with the button? Copy and paste this link:
        </div>
        <div class="url-text">${verificationUrl}</div>
      </div>
    </div>
    <div class="footer">
      <div>This email was sent from <strong>info@vedive.com</strong></div>
      <div>© 2024 Vedive. All rights reserved.</div>
    </div>
  </div>
</body>
</html>
`;

// Beautiful HTML template for password reset email
const getResetPasswordEmailTemplate = resetUrl => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Reset Your Password - Vedive</title>
  <style>/* …your existing CSS… */</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">VEDIVE</div>
      <div>Password Reset Request</div>
    </div>
    <div class="content">
      <h2>Reset Your Password</h2>
      <p>Click the button below to set a new password.</p>
      <a href="${resetUrl}" class="reset-button">
        🔐 Reset My Password
      </a>
      <div class="expire-notice">
        ⏰ This link expires in 1 hour.
      </div>
      <p>If you didn’t request this, you can ignore it.</p>
    </div>
    <div class="footer">
      <div>Sent from <strong>info@vedive.com</strong></div>
      <div>© 2024 Vedive. All rights reserved.</div>
    </div>
  </div>
</body>
</html>
`;

/**
 * Send verification email
 */
async function sendVerificationEmail(email, verificationUrl, name) {
  const mailOptions = {
    from: `"Vedive" <info@vedive.com>`,
    to: email,
    subject: "✓ Verify Your Email Address - Vedive",
    html: getVerificationEmailTemplate(name, verificationUrl)
  };
  const info = await transporter.sendMail(mailOptions);
  console.log("📧 Verification email sent:", info.messageId);
  return info;
}

/**
 * Send password reset email
 */
async function sendResetPasswordEmail(email, resetUrl) {
  const mailOptions = {
    from: `"Vedive" <info@vedive.com>`,
    to: email,
    subject: "🔐 Reset Your Password - Vedive",
    html: getResetPasswordEmailTemplate(resetUrl)
  };
  const info = await transporter.sendMail(mailOptions);
  console.log("📧 Password reset email sent:", info.messageId);
  return info;
}

module.exports = {
  sendVerificationEmail,
  sendResetPasswordEmail
};
