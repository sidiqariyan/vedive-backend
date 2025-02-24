const express = require("express");
const router = express.Router();
const nodemailer = require("nodemailer");
const mongoose = require("mongoose");
const Campaign = require("../models/Campaign"); // Import the Campaign model
const { authenticate } = require("../middleware/authMiddleware"); // Import authentication middleware

// Helper function to validate email addresses
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// API endpoint to send Gmail emails
router.post("/send-gmail", authenticate, async (req, res) => {
  const { gmail, appPassword, from, subject, contacts, body, campaignName } = req.body;

  // Validate required fields
  if (!gmail || !appPassword || !from || !subject || !contacts || !body || !campaignName) {
    return res.status(400).json({ message: "All fields and campaign name are required." });
  }

  // Validate email addresses in the contacts array
  const invalidContacts = contacts.filter((contact) => !isValidEmail(contact));
  if (invalidContacts.length > 0) {
    return res.status(400).json({
      message: "Invalid email addresses found.",
      invalidContacts,
    });
  }

  // Configure Nodemailer transporter
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmail, pass: appPassword },
  });

  // Function to send an email
  const sendEmail = async (contact) => {
    try {
      const mailOptions = { from, to: contact, subject, html: body };
      const info = await transporter.sendMail(mailOptions);
      console.log(`Email sent to ${contact}: ${info.response}`);
      return { contact, status: "success", response: info.response };
    } catch (error) {
      console.error(`Failed to send email to ${contact}:`, error.message);
      return { contact, status: "failed", error: error.message };
    }
  };

  try {
    const results = [];
    for (let i = 0; i < contacts.length; i++) {
      const result = await sendEmail(contacts[i]);
      results.push(result);

      // Add a delay between emails to avoid hitting Gmail's rate limits
      await new Promise((resolve) => setTimeout(resolve, 2000)); // 2-second delay
    }

    // Collect failed emails
    const failedEmails = results.filter((result) => result.status === "failed");

    // Save campaign data to MongoDB
    const newCampaign = new Campaign({
      userId: req.user._id, // Associate the campaign with the authenticated user
      campaignName,
      toolType: "gmail-sender",
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
      smtpUsername: gmail,
      smtpPassword: appPassword,
      fromEmail: from,
      emailSubject: subject,
      recipients: contacts,
    });

    await newCampaign.save();

    // Respond based on email sending results
    if (failedEmails.length > 0) {
      return res.status(500).json({
        message: "Some emails failed to send.",
        errors: failedEmails,
      });
    }

    res.status(200).json({ message: "All emails sent successfully!" });
  } catch (error) {
    console.error("Error sending emails:", error);
    res.status(500).json({ message: "Error sending emails", error: error.message });
  }
});

module.exports = router;