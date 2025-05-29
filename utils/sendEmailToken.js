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

// Updated HTML template using your design
const getVerificationEmailTemplate = (name, verificationUrl, expiryMinutes = 15) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300..800;1,300..800&family=Raleway:ital,wght@0,100..900;1,100..900&display=swap" rel="stylesheet">
  <title>Verification Email</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f2f2f2;
      font-family: 'Arial', sans-serif;
      color: #333;
    }
    .email-container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border: 1px solid #dddddd;
    }
    .header {
      padding: 24px;
      text-align: center;
      position: relative;
    }
    .header img.logo {
      max-width: 150px;
      height: auto;
    }
    .content {
      padding: 24px;
      text-align: center;
    }
    .content h1 {
      font-size: 48px;
      color: #3D34E7;
      margin-bottom: 16px;
      font-family: "Raleway", sans-serif;
      font-optical-sizing: auto;
    }
    .content p {
      font-size: 22px;
      margin-bottom: 24px;
      line-height: 1.5;
      font-family: "Open Sans", sans-serif;
      font-optical-sizing: auto;
    }
    .btn {
      display: inline-block;
      padding: 12px 24px;
      background-color: #3e5fff;
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 24px;
      font-weight: bold;
      margin-bottom: 16px;
    }
    .notice {
      font-size: 12px;
      color: #666666;
      margin-bottom: 24px;
    }
    .link-copy {
      font-size: 14px;
      color: #3e5fff;
      word-break: break-all;
      margin-bottom: 24px;
    }
    .illustration {
      width: 100%;
      height: 595px;
      background-size: cover;
      background-position: center;
      background-image: url('https://your-domain.com/Group398.png');
    }
    .footer {
      background-color: #111111;
      color: #888888;
      padding: 24px;
      text-align: center;
    }
    .social-icons img {
      width: 24px;
      height: 24px;
      margin-bottom: 12px;
    }
    .footer a {
      color: #888888;
      font-size: 12px;
      text-decoration: none;
    }
    .footer .bottom-logo {
      margin-top: 16px;
    }
    .footer .bottom-logo img {
      max-width: 100px;
      height: auto;
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img class="logo" src="https://i.postimg.cc/bDqY1gDM/Logos.png" alt="Company Logo" />
    </div>
    <div class="content">
      <h1>Welcome to our community</h1>
      <p>Hello ${name}! Thank you for joining our platform! Please verify your email by clicking below.</p>
      <a href="${verificationUrl}" class="btn">Verify My Email Address</a>
      <p class="notice">Notice: This link expires in ${expiryMinutes} minutes.<br>If you didn't sign up, ignore this email.</p>
      <p class="notice">Trouble with the button? Copy & paste this link:</p>
      <p class="link-copy">${verificationUrl}</p>
    </div>
    <div class="illustration" id="illustration" style="background-image: url('https://i.postimg.cc/BXb6hmYf/box.png');"></div>
    <div class="footer">
      <div class="social-icons">
        <a href="#"><img src="https://postimg.cc/TpsPBnFL/Facebook.png" alt="Facebook"></a>
        <a href="#"><img src="https://postimg.cc/cv8JWrGDg/instagram.png" alt="Instagram"></a>
        <a href="#"><img src="https://postimg.cc/NyqjjBgQ/linkedin.png" alt="LinkedIn"></a>
      </div>
      <div class="links">
        <a href="https://vedive.com/privacy-policy">Privacy</a>|
        <a href="https://vedive.com">Web</a>|
        <a href="#">Unsubscribe</a>
      </div>
      <div class="bottom-logo">
        <img src="https://postimg.cc/06Y26FQD/Logo.png" alt="Company Logo">
      </div>
    </div>
  </div>
</body>
</html>
`;

// Password reset template (keeping original design but you can update this too)
const getResetPasswordEmailTemplate = (resetUrl, expiryHours = 1) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300..800;1,300..800&family=Raleway:ital,wght@0,100..900;1,100..900&display=swap" rel="stylesheet">
  <title>Password Reset</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f2f2f2;
      font-family: 'Arial', sans-serif;
      color: #333;
    }
    .email-container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border: 1px solid #dddddd;
    }
    .header {
      padding: 24px;
      text-align: center;
      position: relative;
    }
    .header img.logo {
      max-width: 150px;
      height: auto;
    }
    .content {
      padding: 24px;
      text-align: center;
    }
    .content h1 {
      font-size: 48px;
      color: #3D34E7;
      margin-bottom: 16px;
      font-family: "Raleway", sans-serif;
      font-optical-sizing: auto;
    }
    .content p {
      font-size: 22px;
      margin-bottom: 24px;
      line-height: 1.5;
      font-family: "Open Sans", sans-serif;
      font-optical-sizing: auto;
    }
    .btn {
      display: inline-block;
      padding: 12px 24px;
      background-color: #3e5fff;
      color: #ffffff;
      text-decoration: none;
      border-radius: 24px;
      font-weight: bold;
      margin-bottom: 16px;
    }
    .notice {
      font-size: 12px;
      color: #666666;
      margin-bottom: 24px;
    }
    .link-copy {
      font-size: 14px;
      color: #3e5fff;
      word-break: break-all;
      margin-bottom: 24px;
    }
    .illustration {
      width: 100%;
      height: 595px;
      background-size: cover;
      background-position: center;
      background-image: url('https://your-domain.com/Group398.png');
    }
    .footer {
      background-color: #111111;
      color: #888888;
      padding: 24px;
      text-align: center;
    }
    .social-icons img {
      width: 24px;
      height: 24px;
      margin-bottom: 12px;
    }
    .footer a {
      color: #888888;
      font-size: 12px;
      text-decoration: none;
    }
    .footer .bottom-logo {
      margin-top: 16px;
    }
    .footer .bottom-logo img {
      max-width: 100px;
      height: auto;
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <img class="logo" src="https://your-domain.com/Group4.png" alt="Company Logo" />
    </div>
    <div class="content">
      <h1>Reset Your Password</h1>
      <p>Click the button below to set a new password for your account.</p>
      <a href="${resetUrl}" class="btn">Reset My Password</a>
      <p class="notice">Notice: This link expires in ${expiryHours} hour(s).<br>If you didn't request this, ignore this email.</p>
      <p class="notice">Trouble with the button? Copy & paste this link:</p>
      <p class="link-copy">${resetUrl}</p>
    </div>
    <div class="illustration"></div>
    <div class="footer">
      <div class="social-icons">
        <a href="#"><img src="https://your-domain.com/Facebook_logo_(square)1(1).png" alt="Facebook"></a>
        <a href="#"><img src="https://your-domain.com/Instagram_logo_2016.svg2(1).png" alt="Instagram"></a>
        <a href="#"><img src="https://your-domain.com/linkedin-logo-linkedin-logo-transparent-linkedin-icon-transparent-free-free-png1(1).png" alt="LinkedIn"></a>
      </div>
      <div class="links">
        <a href="https://vedive.com/privacy-policy">Privacy</a>|
        <a href="https://vedive.com">Web</a>|
        <a href="#">Unsubscribe</a>
      </div>
      <div class="bottom-logo">
        <img src="https://your-domain.com/Group401.png" alt="Company Logo">
      </div>
    </div>
  </div>
</body>
</html>
`;

/**
 * Send verification email
 */
async function sendVerificationEmail(email, verificationUrl, name, expiryMinutes = 15) {
  const mailOptions = {
    from: `"Vedive" <info@vedive.com>`,
    to: email,
    subject: "✓ Verify Your Email Address - Vedive",
    html: getVerificationEmailTemplate(name, verificationUrl, expiryMinutes)
  };
  const info = await transporter.sendMail(mailOptions);
  console.log("📧 Verification email sent:", info.messageId);
  return info;
}

/**
 * Send password reset email
 */
async function sendResetPasswordEmail(email, resetUrl, expiryHours = 1) {
  const mailOptions = {
    from: `"Vedive" <info@vedive.com>`,
    to: email,
    subject: "🔐 Reset Your Password - Vedive",
    html: getResetPasswordEmailTemplate(resetUrl, expiryHours)
  };
  const info = await transporter.sendMail(mailOptions);
  console.log("📧 Password reset email sent:", info.messageId);
  return info;
}

module.exports = {
  sendVerificationEmail,
  sendResetPasswordEmail
};
