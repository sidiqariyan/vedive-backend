const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const fs = require('fs');
const mongoose = require('mongoose');
const Campaign = require('../models/Campaign'); // Import the Campaign model
const router = express.Router();

// Multer setup for file uploads
const upload = multer({ dest: 'uploads/' });

// API endpoint to send bulk emails
router.post(
  '/send-bulk-mail',
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
        return res.status(400).send('Missing required SMTP, email, or campaign details.');
      }

      // Validate uploaded files
      const recipientsFile = req.files?.recipientsFile?.[0];
      const htmlTemplateFile = req.files?.htmlTemplate?.[0];

      if (!recipientsFile || !htmlTemplateFile) {
        return res.status(400).send('Recipients file and HTML template file are required.');
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
        campaignName,
        toolType: "mail-sender", // Static name for the Gmail sender tool
        smtpHost,
        smtpPort: parseInt(smtpPort),
        smtpUsername,
        smtpPassword,
        fromEmail,
        emailSubject,
        recipients,
      });

      await newCampaign.save();

      // Construct the "from" field with display name
      const fromField = `"${fromEmail}" <${smtpUsername}>`;

      // Filter valid email addresses
      const validRecipients = recipients.filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
      if (validRecipients.length === 0) {
        return res.status(400).send('No valid email addresses found in recipients file.');
      }

      // Send emails to valid recipients
      const sendPromises = validRecipients.map(async (recipient) => {
        try {
          await transporter.sendMail({
            from: fromField, // Use the constructed "from" field
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

      // Clean up uploaded files
      fs.unlinkSync(recipientsFile.path);
      fs.unlinkSync(htmlTemplateFile.path);

      res.send('Bulk emails sent successfully!');
    } catch (error) {
      console.error('Error sending bulk emails:', error);
      res.status(500).send(`Error: ${error.message}`);
    }
  }
);

module.exports = router;