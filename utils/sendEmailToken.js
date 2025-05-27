const nodemailer = require("nodemailer");
require("dotenv").config();

// Create transporter
const transporter = nodemailer.createTransporter({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT || 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Beautiful HTML template for verification email
const getVerificationEmailTemplate = (name, verificationUrl) => {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify Your Email - Vedive</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f4f7fa;
        }
        
        .container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
        }
        
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 40px 30px;
            text-align: center;
            color: white;
        }
        
        .logo {
            font-size: 32px;
            font-weight: bold;
            margin-bottom: 10px;
            text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        }
        
        .header-subtitle {
            font-size: 16px;
            opacity: 0.9;
        }
        
        .content {
            padding: 40px 30px;
            text-align: center;
        }
        
        .welcome-text {
            font-size: 24px;
            font-weight: 600;
            color: #2d3748;
            margin-bottom: 20px;
        }
        
        .message {
            font-size: 16px;
            color: #4a5568;
            margin-bottom: 30px;
            line-height: 1.8;
        }
        
        .verify-button {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 16px 32px;
            text-decoration: none;
            border-radius: 50px;
            font-weight: 600;
            font-size: 16px;
            margin: 20px 0;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
        }
        
        .verify-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
        }
        
        .alternative-link {
            margin-top: 30px;
            padding: 20px;
            background-color: #f7fafc;
            border-radius: 8px;
            border-left: 4px solid #667eea;
        }
        
        .alternative-text {
            font-size: 14px;
            color: #4a5568;
            margin-bottom: 10px;
        }
        
        .url-text {
            font-size: 12px;
            color: #718096;
            word-break: break-all;
            background-color: #edf2f7;
            padding: 8px;
            border-radius: 4px;
            font-family: monospace;
        }
        
        .footer {
            background-color: #2d3748;
            padding: 30px;
            text-align: center;
            color: #a0aec0;
        }
        
        .footer-text {
            font-size: 14px;
            margin-bottom: 10px;
        }
        
        .company-info {
            font-size: 12px;
            opacity: 0.8;
        }
        
        .expire-notice {
            background-color: #fef5e7;
            border: 1px solid #f6e05e;
            border-radius: 8px;
            padding: 15px;
            margin: 20px 0;
            color: #744210;
            font-size: 14px;
        }
        
        .security-notice {
            background-color: #e6fffa;
            border: 1px solid #38b2ac;
            border-radius: 8px;
            padding: 15px;
            margin: 20px 0;
            color: #234e52;
            font-size: 14px;
        }
        
        @media (max-width: 600px) {
            .container {
                margin: 0;
                border-radius: 0;
            }
            
            .header {
                padding: 30px 20px;
            }
            
            .content {
                padding: 30px 20px;
            }
            
            .logo {
                font-size: 28px;
            }
            
            .welcome-text {
                font-size: 20px;
            }
        }
    </style>
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
                Thank you for joining Vedive! We're excited to have you as part of our community. 
                To complete your registration and start exploring, please verify your email address by clicking the button below.
            </div>
            
            <a href="${verificationUrl}" class="verify-button">
                ✓ Verify My Email Address
            </a>
            
            <div class="expire-notice">
                ⏰ <strong>Important:</strong> This verification link will expire in 15 minutes for security reasons.
            </div>
            
            <div class="security-notice">
                🔒 <strong>Security Tip:</strong> If you didn't create an account with us, you can safely ignore this email.
            </div>
            
            <div class="alternative-link">
                <div class="alternative-text">
                    <strong>Having trouble with the button?</strong> Copy and paste this link into your browser:
                </div>
                <div class="url-text">${verificationUrl}</div>
            </div>
        </div>
        
        <div class="footer">
            <div class="footer-text">
                This email was sent from <strong>info@vedive.com</strong>
            </div>
            <div class="company-info">
                © 2024 Vedive. All rights reserved.<br>
                If you have any questions, feel free to contact us at info@vedive.com
            </div>
        </div>
    </div>
</body>
</html>
  `;
};

// Beautiful HTML template for password reset email
const getResetPasswordEmailTemplate = (resetUrl) => {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reset Your Password - Vedive</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f4f7fa;
        }
        
        .container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
        }
        
        .header {
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            padding: 40px 30px;
            text-align: center;
            color: white;
        }
        
        .logo {
            font-size: 32px;
            font-weight: bold;
            margin-bottom: 10px;
        }
        
        .content {
            padding: 40px 30px;
            text-align: center;
        }
        
        .reset-button {
            display: inline-block;
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            color: white;
            padding: 16px 32px;
            text-decoration: none;
            border-radius: 50px;
            font-weight: 600;
            font-size: 16px;
            margin: 20px 0;
            transition: transform 0.2s ease;
            box-shadow: 0 4px 15px rgba(245, 87, 108, 0.4);
        }
        
        .reset-button:hover {
            transform: translateY(-2px);
        }
        
        .footer {
            background-color: #2d3748;
            padding: 30px;
            text-align: center;
            color: #a0aec0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">VEDIVE</div>
            <div>Password Reset Request</div>
        </div>
        
        <div class="content">
            <h2>Reset Your Password</h2>
            <p style="margin: 20px 0; color: #4a5568;">
                We received a request to reset your password. Click the button below to create a new password.
            </p>
            
            <a href="${resetUrl}" class="reset-button">
                🔐 Reset My Password
            </a>
            
            <div style="margin-top: 30px; padding: 20px; background-color: #fef5e7; border-radius: 8px; color: #744210;">
                <strong>⏰ This link will expire in 1 hour</strong>
            </div>
            
            <p style="margin-top: 20px; font-size: 14px; color: #718096;">
                If you didn't request this password reset, you can safely ignore this email.
            </p>
        </div>
        
        <div class="footer">
            <div>This email was sent from <strong>info@vedive.com</strong></div>
            <div style="font-size: 12px; margin-top: 10px;">
                © 2024 Vedive. All rights reserved.
            </div>
        </div>
    </div>
</body>
</html>
  `;
};

// Send verification email
const sendVerificationEmail = async (email, verificationUrl, name) => {
  try {
    const mailOptions = {
      from: {
        name: 'Vedive',
        address: 'info@vedive.com'
      },
      to: email,
      subject: "✓ Verify Your Email Address - Vedive",
      html: getVerificationEmailTemplate(name, verificationUrl),
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Verification email sent: ", info.messageId);
    return info;
  } catch (error) {
    console.error("Error sending verification email: ", error);
    throw error;
  }
};

// Send password reset email
const sendResetPasswordEmail = async (email, resetUrl) => {
  try {
    const mailOptions = {
      from: {
        name: 'Vedive',
        address: 'info@vedive.com'
      },
      to: email,
      subject: "🔐 Reset Your Password - Vedive",
      html: getResetPasswordEmailTemplate(resetUrl),
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Password reset email sent: ", info.messageId);
    return info;
  } catch (error) {
    console.error("Error sending password reset email: ", error);
    throw error;
  }
};

module.exports = {
  sendVerificationEmail,
  sendResetPasswordEmail,
};
