const express = require("express");
const router = express.Router();
const nodemailer = require("nodemailer");
const Campaign = require("../models/Campaign");
const { authenticate } = require("../middleware/authMiddleware");
const { scrapeEmails } = require("../services/scrapeService");
const { generateCSV } = require("../utils/csvWriter");
const pLimit = require("p-limit");
const fs = require("fs");
const multer = require("multer");
const xlsx = require("xlsx");
const csv = require("csv-parser");
const path = require("path");

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.txt', '.csv', '.xlsx'];
    const fileExtension = path.extname(file.originalname).toLowerCase();
    
    if (allowedTypes.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only .txt, .csv, and .xlsx files are allowed.'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Middleware to log all incoming requests
router.use((req, res, next) => {
  console.log(`[${req.method}] ${req.path} - Body:`, req.body);
  next();
});

// Helper function to validate email addresses
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return typeof email === "string" && emailRegex.test(email);
};

// Helper function to process uploaded files
const processUploadedFile = async (fileBuffer, originalName) => {
  const fileExtension = path.extname(originalName).toLowerCase();
  let recipients = [];
  let hasNameColumn = false;

  try {
    if (fileExtension === '.txt') {
      // Process .txt file - simple email list
      const content = fileBuffer.toString('utf8');
      recipients = content
        .split(/[\r\n]+/)
        .map(line => line.trim())
        .filter(line => line && isValidEmail(line))
        .map(email => ({ email, name: null }));
      
      return { recipients, hasNameColumn: false };
      
    } else if (fileExtension === '.csv') {
      // Process .csv file
      return new Promise((resolve, reject) => {
        const results = [];
        const stream = require('stream');
        const bufferStream = new stream.PassThrough();
        bufferStream.end(fileBuffer);
        
        bufferStream
          .pipe(csv())
          .on('data', (row) => {
            results.push(row);
          })
          .on('end', () => {
            try {
              // Check for name column (case insensitive)
              const headers = Object.keys(results[0] || {});
              const nameColumn = headers.find(h => h.toLowerCase().includes('name'));
              hasNameColumn = !!nameColumn;
              
              if (!hasNameColumn) {
                return reject(new Error('CSV file must contain a column with "name" in the header'));
              }
              
              // Find email column
              const emailColumn = headers.find(h => 
                h.toLowerCase().includes('email') || 
                h.toLowerCase().includes('mail')
              );
              
              if (!emailColumn) {
                return reject(new Error('CSV file must contain an email column'));
              }
              
              recipients = results
                .filter(row => row[emailColumn] && isValidEmail(row[emailColumn]))
                .map(row => ({
                  email: row[emailColumn].trim(),
                  name: row[nameColumn] ? row[nameColumn].trim() : null
                }));
              
              resolve({ recipients, hasNameColumn: true });
            } catch (error) {
              reject(error);
            }
          })
          .on('error', reject);
      });
      
    } else if (fileExtension === '.xlsx') {
      // Process .xlsx file
      const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(worksheet);
      
      if (data.length === 0) {
        throw new Error('Excel file is empty');
      }
      
      // Check for name column (case insensitive)
      const headers = Object.keys(data[0]);
      const nameColumn = headers.find(h => h.toLowerCase().includes('name'));
      hasNameColumn = !!nameColumn;
      
      if (!hasNameColumn) {
        throw new Error('Excel file must contain a column with "name" in the header');
      }
      
      // Find email column
      const emailColumn = headers.find(h => 
        h.toLowerCase().includes('email') || 
        h.toLowerCase().includes('mail')
      );
      
      if (!emailColumn) {
        throw new Error('Excel file must contain an email column');
      }
      
      recipients = data
        .filter(row => row[emailColumn] && isValidEmail(row[emailColumn]))
        .map(row => ({
          email: row[emailColumn].toString().trim(),
          name: row[nameColumn] ? row[nameColumn].toString().trim() : null
        }));
      
      return { recipients, hasNameColumn: true };
    }
    
  } catch (error) {
    throw new Error(`Error processing file: ${error.message}`);
  }
  
  return { recipients, hasNameColumn };
};

// Helper function to create anti-spam email configuration
const createAntiSpamTransporter = (gmail, appPassword) => {
  return nodemailer.createTransporter({
    service: "gmail",
    auth: { 
      user: gmail, 
      pass: appPassword 
    },
    pool: true,
    maxConnections: 1,
    maxMessages: 3,
    rateDelta: 60000, // 1 minute
    rateLimit: 3, // 3 emails per minute
    tls: {
      rejectUnauthorized: false
    }
  });
};

// Helper function to personalize email content
const personalizeEmail = (htmlContent, recipientName, recipientEmail) => {
  let personalizedContent = htmlContent;
  
  // Replace common placeholders
  const replacements = {
    '{{name}}': recipientName || 'Valued Customer',
    '{{Name}}': recipientName || 'Valued Customer',
    '{{NAME}}': recipientName ? recipientName.toUpperCase() : 'VALUED CUSTOMER',
    '{{email}}': recipientEmail,
    '{{Email}}': recipientEmail
  };
  
  Object.keys(replacements).forEach(placeholder => {
    personalizedContent = personalizedContent.replace(
      new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), 
      replacements[placeholder]
    );
  });
  
  return personalizedContent;
};

// Create a new campaign
router.post("/create-campaign", authenticate, async (req, res) => {
  try {
    const {
      campaignName,
      toolType,
      smtpHost,
      smtpPort,
      smtpUsername,
      smtpPassword,
      fromEmail,
      emailSubject,
      recipients,
      query,
      scrapedNumbers,
      messageContent,
    } = req.body;

    if (!campaignName || !toolType || !fromEmail) {
      return res.status(400).json({ error: "Missing required fields: campaignName, toolType, or fromEmail" });
    }

    let recipientList = [];
    console.log("Processing recipients:", recipients);
    if (Array.isArray(recipients)) {
      recipientList = recipients;
    } else if (typeof recipients === "string" && recipients.trim()) {
      try {
        recipientList = JSON.parse(recipients);
        if (!Array.isArray(recipientList)) {
          return res.status(400).json({ error: "Parsed recipients must be an array" });
        }
      } catch (error) {
        console.error("Failed to parse recipients:", recipients, "Error:", error.message);
        return res.status(400).json({ error: "Invalid recipients format. Expected a JSON array." });
      }
    } else {
      recipientList = [];
    }

    let numbersList = [];
    console.log("Processing scrapedNumbers:", scrapedNumbers);
    if (Array.isArray(scrapedNumbers)) {
      numbersList = scrapedNumbers;
    } else if (typeof scrapedNumbers === "string" && scrapedNumbers.trim()) {
      try {
        numbersList = JSON.parse(scrapedNumbers);
        if (!Array.isArray(numbersList)) {
          return res.status(400).json({ error: "Parsed scrapedNumbers must be an array" });
        }
      } catch (error) {
        console.error("Failed to parse scrapedNumbers:", scrapedNumbers, "Error:", error.message);
        return res.status(400).json({ error: "Invalid scrapedNumbers format. Expected a JSON array." });
      }
    } else {
      numbersList = [];
    }

    if (
      (toolType === "mail-sender" || toolType === "gmail-sender") &&
      recipientList.length > 0 &&
      recipientList.some((email) => !isValidEmail(email))
    ) {
      return res.status(400).json({ error: "Invalid email address in recipients list" });
    }

    const newCampaign = new Campaign({
      userId: req.user._id,
      campaignName,
      toolType,
      smtpHost: smtpHost || "",
      smtpPort: smtpPort ? parseInt(smtpPort) : 587,
      smtpUsername: smtpUsername || "",
      smtpPassword: smtpPassword || "",
      fromEmail,
      emailSubject: emailSubject || "",
      recipients: recipientList,
      query: query || "",
      scrapedNumbers: numbersList,
      messageContent: messageContent || "",
      status: "pending",
    });

    await newCampaign.save();

    res.status(201).json({
      message: "Campaign created successfully",
      campaign: {
        _id: newCampaign._id,
        campaignName: newCampaign.campaignName,
        toolType: newCampaign.toolType,
        fromEmail: newCampaign.fromEmail,
        emailSubject: newCampaign.emailSubject,
        recipients: newCampaign.recipients,
        status: newCampaign.status,
        createdAt: newCampaign.createdAt,
      },
    });
  } catch (error) {
    console.error("Error in /create-campaign:", error.stack);
    res.status(500).json({ error: "Failed to create campaign" });
  }
});

// Fetch all campaigns
router.get("/campaigns", authenticate, async (req, res) => {
  try {
    const campaigns = await Campaign.find({ userId: req.user._id })
      .select("-smtpPassword")
      .sort({ createdAt: -1 });
    res.status(200).json(campaigns);
  } catch (error) {
    console.error("Error in /campaigns:", error.stack);
    res.status(500).json({ error: "Failed to fetch campaigns" });
  }
});

// Process uploaded file endpoint
router.post("/process-file", authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { recipients, hasNameColumn } = await processUploadedFile(
      req.file.buffer, 
      req.file.originalname
    );

    if (recipients.length === 0) {
      return res.status(400).json({ error: "No valid email addresses found in the file" });
    }

    res.status(200).json({
      message: "File processed successfully",
      recipients: recipients,
      hasNameColumn: hasNameColumn,
      totalRecipients: recipients.length
    });

  } catch (error) {
    console.error("Error processing file:", error);
    res.status(400).json({ error: error.message });
  }
});

// Scrape emails
router.post("/scrape-emails", authenticate, async (req, res) => {
  const { query, pages, domains, campaignName } = req.body;

  if (!query || !campaignName) {
    return res.status(400).json({ error: "Query and Campaign Name are required" });
  }

  const userId = req.user?._id;
  if (!userId) {
    return res.status(401).json({ error: "User must be authenticated" });
  }

  const apiKey = "AIzaSyD_nVwEodt7Mg10vbXWEKXbMVLwBCVDfJI";
  const cx = "a0280e6e13d584edb";
  if (!apiKey || !cx) {
    return res.status(400).json({ error: "API key and CX are required" });
  }

  const defaultDomains = [
    "@gmail.com", "@yahoo.com", "@hotmail.com", "@icloud.com",
    "@aol.com", "@email.com", "@protonmail.com", "@zoho.com",
    "@gmx.com", "@mail.com", "@yandex.com", "@tutanota.com",
    "@fastmail.com", "@sendgrid.com", "@bluehost.com",
    "@qmail.com", "@inbox.com",
  ];

  const customDomains = domains || [];
  const allDomains = [...new Set([...defaultDomains, ...customDomains])];
  const domainQueries = allDomains.map((d) => `"${d}"`).join(" OR ");

  try {
    console.log("Scraping process started...");
    const sites = req.body.sites || ["google.com", "instagram.com"];
    const limit = pLimit(1);

    const emailPromises = sites.map((site) =>
      limit(() =>
        scrapeEmails(`${query} (${domainQueries})`, [site], apiKey, cx, pages).catch((err) => {
          if (err.response && err.response.status === 429) {
            console.error(`Rate limit hit for site: ${site}`);
            return null;
          }
          throw err;
        })
      )
    );

    const emailResults = await Promise.all(emailPromises);
    const emails = emailResults.flat().filter(Boolean);

    if (emails.length === 0) {
      return res.status(404).json({ message: "No emails found" });
    }

    const newCampaign = new Campaign({
      userId,
      campaignName,
      toolType: "email-scraper",
      query,
      recipients: emails,
      status: "completed",
    });

    await newCampaign.save();

    const csvPath = await generateCSV(emails);

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", "attachment; filename=emails.csv");
    res.sendFile(csvPath, (err) => {
      if (err) {
        console.error("Error sending file:", err);
        return res.status(500).json({ error: "Error downloading file" });
      }
      fs.unlinkSync(csvPath);
    });
  } catch (error) {
    console.error("Error in /scrape-emails:", error.stack);
    res.status(500).json({ error: error.message });
  }
});

// Send Gmail emails with enhanced anti-spam features
router.post("/send-gmail", authenticate, upload.single('recipientsFile'), async (req, res) => {
  try {
    const { gmail, appPassword, from, subject, body, campaignName } = req.body;
    let { contacts } = req.body;

    // Validate required fields
    if (!gmail || !appPassword || !from || !subject || !body || !campaignName) {
      return res.status(400).json({ message: "All fields and campaign name are required" });
    }

    let recipientList = [];

    // Process uploaded file if provided
    if (req.file) {
      try {
        const { recipients } = await processUploadedFile(req.file.buffer, req.file.originalname);
        recipientList = recipients;
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
    } else if (contacts) {
      // Process contacts from request body
      console.log("Processing contacts:", contacts);
      if (Array.isArray(contacts)) {
        recipientList = contacts.map(contact => ({
          email: contact,
          name: null
        }));
      } else if (typeof contacts === "string" && contacts.trim()) {
        try {
          const parsedContacts = JSON.parse(contacts);
          if (Array.isArray(parsedContacts)) {
            recipientList = parsedContacts.map(contact => ({
              email: contact,
              name: null
            }));
          } else {
            return res.status(400).json({ error: "Parsed contacts must be an array" });
          }
        } catch (error) {
          // Treat as plain text with email addresses
          recipientList = contacts
            .split(/[\r\n,]+/)
            .map(email => email.trim())
            .filter(email => isValidEmail(email))
            .map(email => ({ email, name: null }));
        }
      }
    }

    if (recipientList.length === 0) {
      return res.status(400).json({ error: "No valid recipients found" });
    }

    // Validate email addresses
    const invalidContacts = recipientList.filter(contact => !isValidEmail(contact.email));
    if (invalidContacts.length > 0) {
      return res.status(400).json({
        message: "Invalid email addresses found",
        invalidContacts: invalidContacts.map(c => c.email),
      });
    }

    // Configure anti-spam transporter
    const transporter = createAntiSpamTransporter(gmail, appPassword);

    // Enhanced email sending function
    const sendEmail = async (recipient) => {
      try {
        // Personalize the email content
        const personalizedBody = personalizeEmail(body, recipient.name, recipient.email);
        
        // Create anti-spam mail options
        const mailOptions = {
          from: `"${from.split('@')[0]}" <${gmail}>`, // Use display name
          to: recipient.email,
          subject: subject,
          html: personalizedBody,
          headers: {
            'X-Priority': '3',
            'X-MSMail-Priority': 'Normal',
            'Importance': 'Normal',
            'List-Unsubscribe': `<mailto:unsubscribe@${gmail.split('@')[1]}>`,
            'X-Mailer': 'Vedive Email Campaign',
          },
          envelope: {
            from: gmail,
            to: recipient.email
          }
        };

        // Add recipient name to subject if available
        if (recipient.name) {
          mailOptions.subject = `${subject} - ${recipient.name}`;
        }

        const info = await transporter.sendMail(mailOptions);
        console.log(`Email sent to ${recipient.email}: ${info.response}`);
        return { 
          contact: recipient.email, 
          name: recipient.name,
          status: "success", 
          response: info.response 
        };
      } catch (error) {
        console.error(`Failed to send email to ${recipient.email}:`, error.message);
        return { 
          contact: recipient.email, 
          name: recipient.name,
          status: "failed", 
          error: error.message 
        };
      }
    };

    // Send emails with proper spacing to avoid spam detection
    const results = [];
    const batchSize = 5; // Send in small batches
    const delayBetweenEmails = 3000; // 3 seconds between emails
    const delayBetweenBatches = 60000; // 1 minute between batches

    for (let i = 0; i < recipientList.length; i += batchSize) {
      const batch = recipientList.slice(i, i + batchSize);
      
      for (const recipient of batch) {
        const result = await sendEmail(recipient);
        results.push(result);
        
        // Wait between emails
        if (i + batch.indexOf(recipient) < recipientList.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenEmails));
        }
      }
      
      // Wait between batches (except for the last batch)
      if (i + batchSize < recipientList.length) {
        console.log(`Completed batch ${Math.floor(i/batchSize) + 1}, waiting before next batch...`);
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }

    // Close the transporter
    transporter.close();

    // Save campaign data
    const newCampaign = new Campaign({
      userId: req.user._id,
      campaignName,
      toolType: "gmail-sender",
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
      smtpUsername: gmail,
      smtpPassword: appPassword,
      fromEmail: from,
      emailSubject: subject,
      recipients: recipientList.map(r => r.email),
      status: results.every((r) => r.status === "success") ? "completed" : "partial",
    });

    await newCampaign.save();

    const failedEmails = results.filter((result) => result.status === "failed");
    const successfulEmails = results.filter((result) => result.status === "success");

    if (failedEmails.length > 0) {
      return res.status(207).json({
        message: `${successfulEmails.length} emails sent successfully, ${failedEmails.length} failed`,
        campaignId: newCampaign._id,
        successful: successfulEmails.length,
        failed: failedEmails.length,
        errors: failedEmails,
      });
    }

    res.status(200).json({
      message: "All emails sent successfully",
      campaignId: newCampaign._id,
      totalSent: successfulEmails.length,
    });

  } catch (error) {
    console.error("Error in /send-gmail:", error.stack);
    res.status(500).json({ message: "Error sending emails", error: error.message });
  }
});

module.exports = router;
