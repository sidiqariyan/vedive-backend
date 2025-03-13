const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const fs = require('fs');
const mongoose = require('mongoose');
const Campaign = require('../models/Campaign'); // Import the Campaign model
const { authenticate } = require('../middleware/authMiddleware'); // Import authentication middleware
const router = express.Router();

// Multer setup for file uploads
const upload = multer({ dest: 'uploads/' });

// API endpoint to send bulk emails
router.post(
  '/send-bulk-mail',
  authenticate, // Protect the route with authentication
  upload.fields([
    { name: 'recipientsFile' }, // File containing recipient email addresses
    { name: 'htmlTemplate' },   // HTML template for the email body
  ]),
  async (req, res) => {
    try {
      const {
        smtpHost,
        smtpPort,
        smtpUsername,
        smtpPassword,
        fromEmail, // Display name for the sender
        emailSubject,
        campaignName,
      } = req.body;

      // Validate required fields
      if (!smtpHost || !smtpPort || !smtpUsername || !smtpPassword || !fromEmail || !emailSubject || !campaignName) {
        return res.status(400).json({ error: 'Missing required SMTP, email, or campaign details.' });
      }

      // Validate uploaded files
      const recipientsFile = req.files?.recipientsFile?.[0];
      const htmlTemplateFile = req.files?.htmlTemplate?.[0];
      if (!recipientsFile || !htmlTemplateFile) {
        return res.status(400).json({ error: 'Recipients file and HTML template file are required.' });
      }

      // Read recipients and email body from uploaded files
      const recipientsData = fs.readFileSync(recipientsFile.path, 'utf-8');
      const recipients = recipientsData.split(/\r?\n/).filter((email) => email.trim() !== '');
      const emailBody = fs.readFileSync(htmlTemplateFile.path, 'utf-8');

      // Configure Nodemailer transporter
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(smtpPort),
        secure: smtpPort == 465, // Use secure connection for port 465
        auth: {
          user: smtpUsername,
          pass: smtpPassword,
        },
      });

      // Save campaign data to MongoDB
      const newCampaign = new Campaign({
        userId: req.user._id, // Authenticated user's ID from middleware
        campaignName,
        toolType: 'mail-sender', // Static name for the Gmail sender tool
        smtpHost,
        smtpPort: parseInt(smtpPort),
        smtpUsername,
        smtpPassword, // Consider encrypting this in production
        fromEmail,
        emailSubject,
        recipients,
        status: 'pending', // Add status to track progress
        createdAt: new Date(), // Add timestamp
      });

      await newCampaign.save();
      console.log('New campaign saved:', newCampaign);

      // Construct the "from" field with display name
      const fromField = `"${fromEmail}" <${smtpUsername}>`;

      // Filter valid email addresses
      const validRecipients = recipients.filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
      if (validRecipients.length === 0) {
        return res.status(400).json({ error: 'No valid email addresses found in recipients file.' });
      }

      // Send emails to valid recipients
      const sendPromises = validRecipients.map(async (recipient) => {
        try {
          await transporter.sendMail({
            from: fromField,
            to: recipient,
            subject: emailSubject,
            html: emailBody,
          });
          console.log(`Email sent to ${recipient}`);
        } catch (err) {
          console.error(`Failed to send email to ${recipient}:`, err.message);
        }
      });

      await Promise.all(sendPromises);

      // Update campaign status
      newCampaign.status = 'completed';
      await newCampaign.save();

      // Clean up uploaded files
      fs.unlinkSync(recipientsFile.path);
      fs.unlinkSync(htmlTemplateFile.path);

      res.json({ message: 'Bulk emails sent successfully!', campaignId: newCampaign._id, success: true });
    } catch (error) {
      console.error('Error sending bulk emails:', error);
      res.status(500).json({ error: 'Failed to send bulk emails', details: error.message });
    }
  }
);

// API endpoint to get user-specific campaigns
router.get('/campaigns', authenticate, async (req, res) => {
  try {
    // Fetch campaigns only for the authenticated user
    const campaigns = await Campaign.find({ userId: req.user._id })
      .select('-smtpPassword') // Exclude sensitive fields
      .sort({ createdAt: -1 });
    console.log(`Fetched ${campaigns.length} campaigns for user ${req.user._id}`);
    res.json(campaigns);
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    res.status(500).json({ error: 'Failed to fetch campaigns', details: error.message });
  }
});

module.exports = router;