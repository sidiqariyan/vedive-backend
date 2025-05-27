const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const csv = require('csv-parser');
const xlsx = require('xlsx');
const Campaign = require('../models/Campaign'); // Import the Campaign model
const { authenticate } = require('../middleware/authMiddleware'); // Import authentication middleware
const router = express.Router();

// Multer setup for file uploads
const upload = multer({ dest: 'uploads/' });

// Helper function to validate file type
const validateFileType = (file, allowedTypes) => {
  const fileExtension = path.extname(file.originalname).toLowerCase();
  return allowedTypes.includes(fileExtension);
};

// Helper function to read recipients from different file types
const readRecipientsFromFile = async (file) => {
  const fileExtension = path.extname(file.originalname).toLowerCase();
  
  try {
    if (fileExtension === '.txt') {
      // Handle .txt files (email addresses only)
      const recipientsData = fs.readFileSync(file.path, 'utf-8');
      const emails = recipientsData.split(/\r?\n/).filter((email) => email.trim() !== '');
      return emails.map(email => ({ email: email.trim(), name: null }));
    } 
    else if (fileExtension === '.csv') {
      // Handle .csv files
      return new Promise((resolve, reject) => {
        const recipients = [];
        let hasNameColumn = false;
        
        fs.createReadStream(file.path)
          .pipe(csv())
          .on('headers', (headers) => {
            // Check if 'name' column exists (case-insensitive)
            hasNameColumn = headers.some(header => 
              header.toLowerCase().trim() === 'name'
            );
            if (!hasNameColumn) {
              reject(new Error('CSV file must contain a "name" column'));
            }
          })
          .on('data', (row) => {
            // Find email and name columns (case-insensitive)
            const emailKey = Object.keys(row).find(key => 
              key.toLowerCase().includes('email') || key.toLowerCase().includes('mail')
            );
            const nameKey = Object.keys(row).find(key => 
              key.toLowerCase().trim() === 'name'
            );
            
            if (emailKey && row[emailKey] && row[emailKey].trim()) {
              recipients.push({
                email: row[emailKey].trim(),
                name: nameKey ? row[nameKey].trim() : null
              });
            }
          })
          .on('end', () => {
            resolve(recipients);
          })
          .on('error', (error) => {
            reject(error);
          });
      });
    } 
    else if (fileExtension === '.xlsx') {
      // Handle .xlsx files
      const workbook = xlsx.readFile(file.path);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(sheet);
      
      if (data.length === 0) {
        throw new Error('Excel file is empty');
      }
      
      // Check if 'name' column exists (case-insensitive)
      const headers = Object.keys(data[0]);
      const hasNameColumn = headers.some(header => 
        header.toLowerCase().trim() === 'name'
      );
      
      if (!hasNameColumn) {
        throw new Error('Excel file must contain a "name" column');
      }
      
      // Extract recipients
      const recipients = [];
      data.forEach(row => {
        const emailKey = Object.keys(row).find(key => 
          key.toLowerCase().includes('email') || key.toLowerCase().includes('mail')
        );
        const nameKey = Object.keys(row).find(key => 
          key.toLowerCase().trim() === 'name'
        );
        
        if (emailKey && row[emailKey] && String(row[emailKey]).trim()) {
          recipients.push({
            email: String(row[emailKey]).trim(),
            name: nameKey ? String(row[nameKey]).trim() : null
          });
        }
      });
      
      return recipients;
    }
    else {
      throw new Error('Unsupported file type');
    }
  } catch (error) {
    throw new Error(`Error reading recipients file: ${error.message}`);
  }
};

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

      // Validate recipients file type
      const allowedRecipientTypes = ['.txt', '.csv', '.xlsx'];
      if (!validateFileType(recipientsFile, allowedRecipientTypes)) {
        return res.status(400).json({ 
          error: 'Invalid recipients file type. Allowed types: .txt, .csv, .xlsx' 
        });
      }

      // Validate HTML template file type
      const allowedTemplateTypes = ['.html', '.htm', '.txt'];
      if (!validateFileType(htmlTemplateFile, allowedTemplateTypes)) {
        return res.status(400).json({ 
          error: 'Invalid HTML template file type. Allowed types: .html, .htm, .txt' 
        });
      }

      // Read recipients from file with validation
      let recipientsData;
      try {
        recipientsData = await readRecipientsFromFile(recipientsFile);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }

      // Read email body from HTML template file
      const emailBody = fs.readFileSync(htmlTemplateFile.path, 'utf-8');

      // Configure Nodemailer transporter
      const transporter = nodemailer.createTransporter({
        host: smtpHost,
        port: parseInt(smtpPort),
        secure: smtpPort == 465, // Use secure connection for port 465
        auth: {
          user: smtpUsername,
          pass: smtpPassword,
        },
      });

      // Extract emails for database storage
      const emailAddresses = recipientsData.map(recipient => recipient.email);

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
        recipients: emailAddresses, // Store email addresses for backward compatibility
        recipientsWithNames: recipientsData, // Store full recipient data with names
        status: 'pending', // Add status to track progress
        createdAt: new Date(), // Add timestamp
      });

      await newCampaign.save();
      console.log('New campaign saved:', newCampaign);

      // Construct the "from" field with display name
      const fromField = `"${fromEmail}" <${smtpUsername}>`;

      // Filter valid email addresses
      const validRecipients = recipientsData.filter((recipient) => 
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email)
      );
      
      if (validRecipients.length === 0) {
        return res.status(400).json({ error: 'No valid email addresses found in recipients file.' });
      }

      // Send emails to valid recipients
      const sendPromises = validRecipients.map(async (recipient) => {
        try {
          // Personalize email body if name is available
          let personalizedBody = emailBody;
          if (recipient.name) {
            // Replace placeholders like {{name}} or [name] with actual name
            personalizedBody = emailBody
              .replace(/\{\{name\}\}/gi, recipient.name)
              .replace(/\[name\]/gi, recipient.name);
          }

          await transporter.sendMail({
            from: fromField,
            to: recipient.email,
            subject: emailSubject,
            html: personalizedBody,
          });
          console.log(`Email sent to ${recipient.email} (${recipient.name || 'No name'})`);
        } catch (err) {
          console.error(`Failed to send email to ${recipient.email}:`, err.message);
        }
      });

      await Promise.all(sendPromises);

      // Update campaign status
      newCampaign.status = 'completed';
      await newCampaign.save();

      // Clean up uploaded files
      fs.unlinkSync(recipientsFile.path);
      fs.unlinkSync(htmlTemplateFile.path);

      res.json({ 
        message: 'Bulk emails sent successfully!', 
        campaignId: newCampaign._id, 
        success: true,
        totalRecipients: validRecipients.length,
        recipientsWithNames: validRecipients.filter(r => r.name).length
      });
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
