const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const csv = require('csv-parser');
const xlsx = require('xlsx');
const crypto = require('crypto');
const Campaign = require('../models/Campaign'); // Import the Campaign model
const { authenticate } = require('../middleware/authMiddleware'); // Import authentication middleware
const router = express.Router();

// Multer setup for file uploads
const upload = multer({ dest: 'uploads/' });

// Anti-spam configuration and helpers
const ANTI_SPAM_CONFIG = {
  MAX_BATCH_SIZE: 50, // Send emails in smaller batches
  DELAY_BETWEEN_BATCHES: 2000, // 2 seconds delay between batches
  DELAY_BETWEEN_EMAILS: 100, // 100ms delay between individual emails
  MAX_EMAILS_PER_HOUR: 500, // Rate limiting
  SPAM_KEYWORDS: [
    'free', 'urgent', 'limited time', 'act now', 'click here',
    'guaranteed', 'no obligation', 'risk free', 'special promotion',
    'winner', 'congratulations', 'cash', 'money back', '$', 'buy now',
    'order now', 'call now', 'don\'t delay', 'once in a lifetime',
    'miracle', 'breakthrough', 'exclusive deal', 'limited offer'
  ]
};

// Helper function to check for spam keywords
const containsSpamKeywords = (subject, body) => {
  const text = `${subject} ${body}`.toLowerCase();
  const foundKeywords = ANTI_SPAM_CONFIG.SPAM_KEYWORDS.filter(keyword => 
    text.includes(keyword.toLowerCase())
  );
  
  return {
    hasSpamKeywords: foundKeywords.length > 0,
    foundKeywords: foundKeywords
  };
};

// Helper function to generate anti-spam headers
const getAntiSpamHeaders = (domain, campaignId) => {
  const messageId = `<${crypto.randomUUID()}@${domain}>`;
  const listId = `<campaign-${campaignId}@${domain}>`;
  
  return {
    'Message-ID': messageId,
    'List-ID': listId,
    'List-Unsubscribe': `<mailto:unsubscribe-${campaignId}@${domain}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    'Precedence': 'bulk',
    'X-Mailer': 'Vedive Bulk Mailer v1.0',
    'X-Campaign-ID': campaignId.toString(),
    'MIME-Version': '1.0',
    'Content-Type': 'text/html; charset=UTF-8',
    'X-Priority': '3',
    'X-MSMail-Priority': 'Normal',
    'Return-Path': `bounce-${campaignId}@${domain}`,
    'Errors-To': `bounce-${campaignId}@${domain}`
  };
};

// Helper function to improve email content for better deliverability
const improveEmailContent = (emailBody, recipientName, domain, campaignId) => {
  let improvedBody = emailBody;
  
  // Add personalization if name is provided
  if (recipientName) {
    improvedBody = improvedBody.replace(/\{name\}/gi, recipientName);
    improvedBody = improvedBody.replace(/\{first_name\}/gi, recipientName.split(' ')[0]);
  }
  
  // Add unsubscribe link if not present
  const unsubscribeLink = `<p style="font-size: 12px; color: #666; margin-top: 20px; border-top: 1px solid #eee; padding-top: 10px;">
    If you no longer wish to receive these emails, you can 
    <a href="mailto:unsubscribe-${campaignId}@${domain}?subject=Unsubscribe" style="color: #666;">unsubscribe here</a>.
  </p>`;
  
  // Check if unsubscribe link already exists
  if (!improvedBody.toLowerCase().includes('unsubscribe')) {
    // Try to add before closing body tag, otherwise append
    if (improvedBody.toLowerCase().includes('</body>')) {
      improvedBody = improvedBody.replace('</body>', `${unsubscribeLink}</body>`);
    } else {
      improvedBody += unsubscribeLink;
    }
  }
  
  // Add proper HTML structure if missing
  if (!improvedBody.toLowerCase().includes('<html>')) {
    improvedBody = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Email</title>
</head>
<body>
    ${improvedBody}
</body>
</html>`;
  }
  
  return improvedBody;
};

// Helper function to send emails in batches
const sendEmailsInBatches = async (transporter, emailData, recipients, campaignId) => {
  const results = {
    sent: 0,
    failed: 0,
    errors: []
  };
  
  const batches = [];
  for (let i = 0; i < recipients.length; i += ANTI_SPAM_CONFIG.MAX_BATCH_SIZE) {
    batches.push(recipients.slice(i, i + ANTI_SPAM_CONFIG.MAX_BATCH_SIZE));
  }
  
  console.log(`Sending ${recipients.length} emails in ${batches.length} batches`);
  
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    console.log(`Processing batch ${batchIndex + 1}/${batches.length} with ${batch.length} recipients`);
    
    for (const recipient of batch) {
      try {
        // Personalize email content
        const personalizedBody = improveEmailContent(
          emailData.html, 
          recipient.name, 
          emailData.headers['List-ID'].split('@')[1].replace('>', ''),
          campaignId
        );
        
        const mailOptions = {
          ...emailData,
          to: recipient.email,
          html: personalizedBody
        };
        
        await transporter.sendMail(mailOptions);
        results.sent++;
        console.log(`Email sent successfully to: ${recipient.email}`);
        
        // Delay between individual emails
        if (ANTI_SPAM_CONFIG.DELAY_BETWEEN_EMAILS > 0) {
          await new Promise(resolve => setTimeout(resolve, ANTI_SPAM_CONFIG.DELAY_BETWEEN_EMAILS));
        }
        
      } catch (error) {
        results.failed++;
        results.errors.push({
          email: recipient.email,
          error: error.message
        });
        console.error(`Failed to send email to ${recipient.email}:`, error.message);
      }
    }
    
    // Delay between batches (except for the last batch)
    if (batchIndex < batches.length - 1 && ANTI_SPAM_CONFIG.DELAY_BETWEEN_BATCHES > 0) {
      console.log(`Waiting ${ANTI_SPAM_CONFIG.DELAY_BETWEEN_BATCHES}ms before next batch...`);
      await new Promise(resolve => setTimeout(resolve, ANTI_SPAM_CONFIG.DELAY_BETWEEN_BATCHES));
    }
  }
  
  return results;
};

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

      // Extract domain for anti-spam headers
      const fromDomain = smtpUsername.split('@')[1] || 'localhost';
      
      // Check for spam keywords in subject and email body
      const spamCheck = containsSpamKeywords(emailSubject, emailBody);
      if (spamCheck.hasSpamKeywords) {
        console.warn('Warning: Potential spam keywords detected:', spamCheck.foundKeywords);
        // You can choose to block the email or just warn
        // return res.status(400).json({ 
        //   error: 'Email contains potential spam keywords', 
        //   keywords: spamCheck.foundKeywords 
        // });
      }

      // Configure Nodemailer transporter with anti-spam settings
      const transporter = nodemailer.createTransporter({
        host: smtpHost,
        port: parseInt(smtpPort),
        secure: smtpPort == 465, // Use secure connection for port 465
        auth: {
          user: smtpUsername,
          pass: smtpPassword,
        },
        // Additional anti-spam configurations
        pool: true, // Use connection pooling
        maxConnections: 5, // Limit concurrent connections
        maxMessages: 100, // Limit messages per connection
        rateDelta: 1000, // Rate limiting: 1 second
        rateLimit: 5, // Rate limiting: 5 emails per rateDelta
        tls: {
          rejectUnauthorized: false, // Accept self-signed certificates
          ciphers: 'SSLv3'
        },
        dkim: {
          // You can add DKIM signing here if you have keys
          // domainName: fromDomain,
          // keySelector: 'default',
          // privateKey: 'your-private-key'
        }
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

      // Construct the "from" field with display name (more professional)
      const fromField = `"${fromEmail}" <${smtpUsername}>`;
      
      // Get anti-spam headers
      const antiSpamHeaders = getAntiSpamHeaders(fromDomain, newCampaign._id);

      // Filter valid email addresses
      const validRecipients = recipientsData.filter((recipient) => 
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email)
      );
      
      if (validRecipients.length === 0) {
        return res.status(400).json({ error: 'No valid email addresses found in recipients file.' });
      }

      // Check rate limiting
      if (validRecipients.length > ANTI_SPAM_CONFIG.MAX_EMAILS_PER_HOUR) {
        return res.status(400).json({ 
          error: `Too many recipients. Maximum ${ANTI_SPAM_CONFIG.MAX_EMAILS_PER_HOUR} emails per batch allowed.`,
          recipientCount: validRecipients.length,
          maxAllowed: ANTI_SPAM_CONFIG.MAX_EMAILS_PER_HOUR
        });
      }

      // Improve email content for better deliverability
      const improvedEmailBody = improveEmailContent(emailBody, null, fromDomain, newCampaign._id);

      // Prepare email data with anti-spam headers
      const emailData = {
        from: fromField,
        subject: emailSubject,
        html: improvedEmailBody,
        headers: antiSpamHeaders,
        // Additional options for better deliverability
        envelope: {
          from: smtpUsername,
          to: validRecipients.map(r => r.email)
        },
        messageId: antiSpamHeaders['Message-ID'],
        date: new Date(),
        encoding: 'utf8'
      };

      console.log(`Preparing to send ${validRecipients.length} emails with anti-spam measures`);

      // Send emails in batches with delays to avoid spam detection
      const sendResults = await sendEmailsInBatches(transporter, emailData, validRecipients, newCampaign._id);

      // Update campaign status with results
      newCampaign.status = 'completed';
      newCampaign.emailsSent = sendResults.sent;
      newCampaign.emailsFailed = sendResults.failed;
      newCampaign.sendErrors = sendResults.errors;
      await newCampaign.save();

      // Close transporter
      transporter.close();

      // Clean up uploaded files
      fs.unlinkSync(recipientsFile.path);
      fs.unlinkSync(htmlTemplateFile.path);

      res.json({ 
        message: 'Bulk emails sent successfully with anti-spam measures!', 
        campaignId: newCampaign._id, 
        success: true,
        totalRecipients: validRecipients.length,
        emailsSent: sendResults.sent,
        emailsFailed: sendResults.failed,
        recipientsWithNames: validRecipients.filter(r => r.name).length,
        antiSpamFeatures: {
          batchSending: true,
          rateLimiting: true,
          properHeaders: true,
          unsubscribeLink: true,
          spamKeywordCheck: spamCheck.hasSpamKeywords ? spamCheck.foundKeywords : null
        }
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
