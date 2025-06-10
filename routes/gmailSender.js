const express = require("express");
const crypto = require('crypto');
const router = express.Router();
const nodemailer = require("nodemailer");
const Campaign = require("../models/Campaign");
const LinkTracking = require("../models/LinkTracking");
const EmailTracking = require("../models/EmailTracking");
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
  return nodemailer.createTransport({
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

router.get("/track/:trackingId", async (req, res) => {
  try {
    const { trackingId } = req.params;
    
    // Better IP address detection
    const ipAddress = req.headers['x-forwarded-for'] || 
                     req.headers['x-real-ip'] || 
                     req.connection.remoteAddress || 
                     req.socket.remoteAddress ||
                     (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
                     req.ip;

    const userAgent = req.get('User-Agent') || '';

    console.log(`🔍 Tracking pixel accessed for ID: ${trackingId}`);
    console.log(`📍 IP: ${ipAddress}, User-Agent: ${userAgent}`);

    // Find and update tracking record
    const tracking = await EmailTracking.findOne({ trackingId });
    
    if (tracking) {
      // Update tracking data (works with your current model)
      if (!tracking.opened) {
        tracking.opened = true;
        tracking.openedAt = new Date();
        console.log(`✅ First time open detected for: ${tracking.recipientEmail}`);
      }
      tracking.openCount += 1;
      tracking.userAgent = userAgent;
      tracking.ipAddress = ipAddress;
      
      await tracking.save();
      console.log(`📊 Email tracking updated: ${tracking.recipientEmail} (Count: ${tracking.openCount})`);
    } else {
      console.log(`❌ No tracking record found for ID: ${trackingId}`);
    }

    // Return 1x1 transparent pixel with proper headers
    const pixel = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64'
    );

    res.set({
      'Content-Type': 'image/png',
      'Content-Length': pixel.length,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type'
    });

    res.status(200).send(pixel);
  } catch (error) {
    console.error('❌ Error in tracking pixel:', error);
    // Still return pixel even if tracking fails
    const pixel = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64'
    );
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'no-cache'
    });
    res.status(200).send(pixel);
  }
});


router.get("/debug-tracking/:campaignId", authenticate, async (req, res) => {
  try {
    const { campaignId } = req.params;
    
    const campaign = await Campaign.findOne({ 
      _id: campaignId, 
      userId: req.user._id 
    });
    
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    const trackingData = await EmailTracking.find({ campaignId });
    const baseUrl = process.env.BASE_URL || 'https://vedive.com:3000';
    
    res.json({
      campaign: {
        id: campaign._id,
        name: campaign.campaignName,
        status: campaign.status,
        recipientCount: campaign.recipients.length,
        createdAt: campaign.createdAt
      },
      tracking: {
        totalRecords: trackingData.length,
        openedEmails: trackingData.filter(t => t.opened).length,
        openRate: trackingData.length > 0 ? 
          ((trackingData.filter(t => t.opened).length / trackingData.length) * 100).toFixed(2) : 0,
        totalOpens: trackingData.reduce((sum, t) => sum + t.openCount, 0),
        records: trackingData.map(t => ({
          email: t.recipientEmail,
          name: t.recipientName,
          trackingId: t.trackingId,
          opened: t.opened,
          openCount: t.openCount,
          openedAt: t.openedAt,
          userAgent: t.userAgent,
          ipAddress: t.ipAddress,
          pixelUrl: `${baseUrl}/api/track/${t.trackingId}`,
          testUrl: `${baseUrl}/api/test-pixel/${t.trackingId}`
        }))
      },
      baseUrl: baseUrl,
      instructions: {
        testTracking: `Visit ${baseUrl}/api/test-pixel/TRACKING_ID to manually test`,
        checkLogs: "Check server logs for tracking pixel access attempts",
        emailClient: "Ensure email client loads images (check spam folder too)"
      }
    });

  } catch (error) {
    console.error('Error in debug tracking:', error);
    res.status(500).json({ error: 'Failed to debug tracking' });
  }
});

// 4. MANUAL PIXEL TEST ROUTE
router.get("/test-pixel/:trackingId", async (req, res) => {
  try {
    const { trackingId } = req.params;
    const baseUrl = process.env.BASE_URL || 'https://vedive.com:3000';
    
    // Check if tracking record exists
    const tracking = await EmailTracking.findOne({ trackingId });
    
    if (!tracking) {
      return res.status(404).send(`
        <h1>❌ Tracking ID Not Found</h1>
        <p>No tracking record found for ID: <code>${trackingId}</code></p>
        <p><a href="${baseUrl}/api/track/${trackingId}">Test Pixel URL</a></p>
      `);
    }

    // Create a test page that loads the tracking pixel
    const testPage = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Tracking Pixel Test</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; }
          .info { background: #f0f8ff; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .tracking-box { background: #fffacd; padding: 15px; border-radius: 5px; margin: 10px 0; }
          code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; }
        </style>
      </head>
      <body>
        <h1>📊 Tracking Pixel Test</h1>
        
        <div class="info">
          <h3>Current Tracking Status:</h3>
          <p><strong>Email:</strong> ${tracking.recipientEmail}</p>
          <p><strong>Name:</strong> ${tracking.recipientName || 'N/A'}</p>
          <p><strong>Opened:</strong> ${tracking.opened ? '✅ Yes' : '❌ No'}</p>
          <p><strong>Open Count:</strong> ${tracking.openCount}</p>
          <p><strong>Last Opened:</strong> ${tracking.openedAt || 'Never'}</p>
        </div>

        <div class="tracking-box">
          <h3>🔍 Testing Tracking Pixel</h3>
          <p>The tracking pixel below should trigger when this page loads:</p>
          <p><strong>Pixel URL:</strong> <code>${baseUrl}/api/track/${trackingId}</code></p>
          
          <!-- Multiple tracking pixels for testing -->
          <img src="${baseUrl}/api/track/${trackingId}" width="1" height="1" style="display:none;" alt="tracking pixel 1" />
          <img src="${baseUrl}/api/track/${trackingId}?test=1" width="1" height="1" style="opacity:0;" alt="tracking pixel 2" />
          
          <p>✅ If tracking is working, the open count above should increase when you refresh this page.</p>
        </div>

        <div class="info">
          <h3>🔧 Troubleshooting:</h3>
          <ul>
            <li>Check server logs for tracking pixel access</li>
            <li>Ensure BASE_URL environment variable is set correctly</li>
            <li>Verify the tracking route is accessible: <a href="${baseUrl}/api/track/${trackingId}" target="_blank">Test Direct Access</a></li>
            <li>Email clients may block images - check image loading settings</li>
          </ul>
        </div>

        <p><a href="javascript:window.location.reload()">🔄 Refresh to Test Again</a></p>
        
        <script>
          // Also test via JavaScript
          setTimeout(() => {
            const img = new Image();
            img.src = '${baseUrl}/api/track/${trackingId}?js=1&t=' + Date.now();
            console.log('JavaScript tracking pixel loaded');
          }, 1000);
        </script>
      </body>
      </html>
    `;

    res.send(testPage);

  } catch (error) {
    console.error('Error in test pixel:', error);
    res.status(500).send(`<h1>Error</h1><p>${error.message}</p>`);
  }
});

// Get campaign analytics
router.get("/analytics/:campaignId", authenticate, async (req, res) => {
  try {
    const { campaignId } = req.params;
    
    // Verify campaign belongs to user
    const campaign = await Campaign.findOne({ 
      _id: campaignId, 
      userId: req.user._id 
    });
    
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    // Get tracking data
    const trackingData = await EmailTracking.find({ campaignId });
    
    // Calculate analytics
    const totalEmails = trackingData.length;
    const openedEmails = trackingData.filter(t => t.opened).length;
    const unopenedEmails = totalEmails - openedEmails;
    const openRate = totalEmails > 0 ? ((openedEmails / totalEmails) * 100).toFixed(2) : 0;
    const totalOpens = trackingData.reduce((sum, t) => sum + t.openCount, 0);

    // Get detailed recipient data
    const recipients = trackingData.map(tracking => ({
      email: tracking.recipientEmail,
      name: tracking.recipientName,
      opened: tracking.opened,
      openedAt: tracking.openedAt,
      openCount: tracking.openCount,
      userAgent: tracking.userAgent,
      ipAddress: tracking.ipAddress
    }));

    // Get open timeline (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentOpens = trackingData
      .filter(t => t.openedAt && t.openedAt >= sevenDaysAgo)
      .sort((a, b) => new Date(a.openedAt) - new Date(b.openedAt));

    const timeline = {};
    recentOpens.forEach(tracking => {
      const date = tracking.openedAt.toISOString().split('T')[0];
      timeline[date] = (timeline[date] || 0) + 1;
    });

    res.json({
      campaign: {
        id: campaign._id,
        name: campaign.campaignName,
        subject: campaign.emailSubject,
        createdAt: campaign.createdAt
      },
      analytics: {
        totalEmails,
        openedEmails,
        unopenedEmails,
        openRate: parseFloat(openRate),
        totalOpens,
        uniqueOpens: openedEmails
      },
      recipients,
      timeline: Object.keys(timeline).map(date => ({
        date,
        opens: timeline[date]
      }))
    });

  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Get all campaigns with basic analytics
router.get("/campaigns-with-analytics", authenticate, async (req, res) => {
  try {
    const campaigns = await Campaign.find({ userId: req.user._id })
      .select("-smtpPassword")
      .sort({ createdAt: -1 });

    const campaignsWithAnalytics = await Promise.all(
      campaigns.map(async (campaign) => {
        const trackingData = await EmailTracking.find({ campaignId: campaign._id });
        const totalEmails = trackingData.length;
        const openedEmails = trackingData.filter(t => t.opened).length;
        const openRate = totalEmails > 0 ? ((openedEmails / totalEmails) * 100).toFixed(2) : 0;

        return {
          ...campaign.toObject(),
          analytics: {
            totalEmails,
            openedEmails,
            openRate: parseFloat(openRate)
          }
        };
      })
    );

    res.json(campaignsWithAnalytics);
  } catch (error) {
    console.error('Error fetching campaigns with analytics:', error);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});
const processLinksForTracking = (htmlContent, campaignId, recipientEmail, trackingId) => {
  const baseUrl = process.env.BASE_URL || 'https://vedive.com:3000';
  let processedContent = htmlContent;
  const links = [];
  
  // Regular expression to find all links
  const linkRegex = /<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1[^>]*>(.*?)<\/a>/gi;
  
  let match;
  let linkIndex = 0;
  
  while ((match = linkRegex.exec(htmlContent)) !== null) {
    const [fullMatch, quote, originalUrl, linkText] = match;
    
    // Skip if it's already a tracking URL or an anchor link
    if (originalUrl.includes('/api/link/') || originalUrl.startsWith('#') || originalUrl.startsWith('mailto:')) {
      continue;
    }
    
    // Generate unique link tracking ID
    const linkTrackingId = crypto.randomBytes(16).toString('hex');
    
    // Create tracking URL
    const trackingUrl = `${baseUrl}/api/link/${linkTrackingId}`;
    
    // Replace the original URL with tracking URL
    const newLinkTag = fullMatch.replace(originalUrl, trackingUrl);
    processedContent = processedContent.replace(fullMatch, newLinkTag);
    
    // Store link information
    links.push({
      linkTrackingId,
      originalUrl,
      linkText: linkText.replace(/<[^>]*>/g, ''), // Remove HTML tags from link text
      linkIndex: linkIndex++,
      campaignId,
      recipientEmail,
      emailTrackingId: trackingId
    });
  }
  
  return { processedContent, links };
};

const sendEmailWithLinkTracking = async (recipient, transporter, emailContent, newCampaign) => {
  try {
    const trackingId = recipient.trackingToken;
    
    console.log(`📧 Preparing to send email to: ${recipient.email}`);
    
    // Create email tracking record
    const emailTracking = new EmailTracking({
      campaignId: newCampaign._id,
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      trackingId: trackingId
    });
    await emailTracking.save();

    // Process links for tracking
    const { processedContent: htmlWithTrackedLinks, links } = processLinksForTracking(
      emailContent.body, 
      newCampaign._id, 
      recipient.email, 
      trackingId
    );

    // Create link tracking records
    if (links.length > 0) {
      const linkTrackingRecords = links.map(link => new LinkTracking({
        linkTrackingId: link.linkTrackingId,
        campaignId: link.campaignId,
        emailTrackingId: link.emailTrackingId,
        recipientEmail: link.recipientEmail,
        recipientName: recipient.name,
        originalUrl: link.originalUrl,
        linkText: link.linkText,
        linkIndex: link.linkIndex
      }));

      await LinkTracking.insertMany(linkTrackingRecords);
      console.log(`🔗 Created ${links.length} link tracking records for ${recipient.email}`);
    }

    // Personalize the email content (with tracked links)
    let personalizedBody = personalizeEmail(htmlWithTrackedLinks, recipient.name, recipient.email);
    
    // Add email open tracking pixel
    const baseUrl = process.env.BASE_URL || 'https://vedive.com:3000';
    const trackingPixel = `<img src="${baseUrl}/api/track/${trackingId}" width="1" height="1" style="display:none;" alt="" />`;
    
    if (personalizedBody.includes('</body>')) {
      personalizedBody = personalizedBody.replace('</body>', `${trackingPixel}</body>`);
    } else {
      personalizedBody += trackingPixel;
    }
    
    // Send email (rest of your existing email sending logic)
    const mailOptions = {
      from: `"${emailContent.from.split('@')[0]}" <${emailContent.gmail}>`,
      to: recipient.email,
      subject: emailContent.subject,
      html: personalizedBody,
      headers: {
        'X-Campaign-ID': newCampaign._id.toString(),
        'X-Tracking-ID': trackingId,
        'List-Unsubscribe': `<mailto:unsubscribe@${emailContent.gmail.split('@')[1]}>`
      }
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${recipient.email} with ${links.length} tracked links`);
    
    return { 
      contact: recipient.email, 
      name: recipient.name,
      status: "success", 
      response: info.response,
      trackingId: trackingId,
      trackedLinks: links.length
    };

  } catch (error) {
    console.error(`❌ Failed to send email to ${recipient.email}:`, error.message);
    return { 
      contact: recipient.email, 
      status: "failed", 
      error: error.message 
    };
  }
};


router.get("/link/:linkTrackingId", async (req, res) => {
  try {
    const { linkTrackingId } = req.params;
    
    // Get client information
    const ipAddress = req.headers['x-forwarded-for'] || 
                     req.headers['x-real-ip'] || 
                     req.connection.remoteAddress || 
                     req.socket.remoteAddress ||
                     req.ip;
    const userAgent = req.get('User-Agent') || '';
    const referer = req.get('Referer') || '';

    console.log(`🔗 Link clicked: ${linkTrackingId}`);
    console.log(`📍 IP: ${ipAddress}, User-Agent: ${userAgent}`);

    // Find link tracking record
    const linkTracking = await LinkTracking.findOne({ linkTrackingId });
    
    if (!linkTracking) {
      console.log(`❌ Link tracking record not found: ${linkTrackingId}`);
      return res.status(404).send('Link not found');
    }

    // Update tracking data
    const clickData = {
      clickedAt: new Date(),
      userAgent,
      ipAddress,
      referer
    };

    if (!linkTracking.clicked) {
      linkTracking.clicked = true;
      linkTracking.clickedAt = clickData.clickedAt;
      console.log(`✅ First click detected for: ${linkTracking.recipientEmail} -> ${linkTracking.originalUrl}`);
    }

    linkTracking.clickCount += 1;
    linkTracking.lastClickedAt = clickData.clickedAt;
    linkTracking.userAgent = userAgent;
    linkTracking.ipAddress = ipAddress;
    linkTracking.referer = referer;
    linkTracking.clickHistory.push(clickData);

    await linkTracking.save();

    console.log(`📊 Link tracking updated: ${linkTracking.recipientEmail} clicked "${linkTracking.linkText}" (Count: ${linkTracking.clickCount})`);

    // Redirect to original URL
    res.redirect(302, linkTracking.originalUrl);

  } catch (error) {
    console.error('❌ Error in link tracking:', error);
    res.status(500).send('Error processing link');
  }
});

// Get link analytics for a campaign
router.get("/link-analytics/:campaignId", authenticate, async (req, res) => {
  try {
    const { campaignId } = req.params;
    
    // Verify campaign belongs to user
    const campaign = await Campaign.findOne({ 
      _id: campaignId, 
      userId: req.user._id 
    });
    
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    // Get all link tracking data for this campaign
    const linkTrackingData = await LinkTracking.find({ campaignId }).sort({ linkIndex: 1 });
    
    // Group by original URL to get unique links
    const linkStats = {};
    
    linkTrackingData.forEach(link => {
      const key = `${link.originalUrl}||${link.linkText}`;
      
      if (!linkStats[key]) {
        linkStats[key] = {
          originalUrl: link.originalUrl,
          linkText: link.linkText,
          linkIndex: link.linkIndex,
          totalRecipients: 0,
          uniqueClicks: 0,
          totalClicks: 0,
          clickRate: 0,
          recipients: []
        };
      }
      
      linkStats[key].totalRecipients++;
      linkStats[key].totalClicks += link.clickCount;
      
      if (link.clicked) {
        linkStats[key].uniqueClicks++;
      }
      
      linkStats[key].recipients.push({
        email: link.recipientEmail,
        name: link.recipientName,
        clicked: link.clicked,
        clickCount: link.clickCount,
        clickedAt: link.clickedAt,
        lastClickedAt: link.lastClickedAt,
        clickHistory: link.clickHistory
      });
    });

    // Calculate click rates and format data
    const linkAnalytics = Object.values(linkStats).map(stat => ({
      ...stat,
      clickRate: stat.totalRecipients > 0 ? 
        ((stat.uniqueClicks / stat.totalRecipients) * 100).toFixed(2) : 0
    })).sort((a, b) => a.linkIndex - b.linkIndex);

    // Overall statistics
    const totalLinks = linkAnalytics.length;
    const totalUniqueClicks = linkAnalytics.reduce((sum, link) => sum + link.uniqueClicks, 0);
    const totalClicks = linkAnalytics.reduce((sum, link) => sum + link.totalClicks, 0);
    const totalRecipients = campaign.recipients.length;
    const overallClickRate = totalRecipients > 0 ? 
      ((totalUniqueClicks / totalRecipients) * 100).toFixed(2) : 0;

    // Most clicked links
    const mostClickedLinks = [...linkAnalytics]
      .sort((a, b) => b.uniqueClicks - a.uniqueClicks)
      .slice(0, 5);

    res.json({
      campaign: {
        id: campaign._id,
        name: campaign.campaignName,
        subject: campaign.emailSubject,
        createdAt: campaign.createdAt
      },
      summary: {
        totalLinks,
        totalUniqueClicks,
        totalClicks,
        totalRecipients,
        overallClickRate: parseFloat(overallClickRate)
      },
      linkAnalytics,
      mostClickedLinks,
      topPerformers: mostClickedLinks.slice(0, 3)
    });

  } catch (error) {
    console.error('Error fetching link analytics:', error);
    res.status(500).json({ error: 'Failed to fetch link analytics' });
  }
});

// Get detailed click timeline for a specific link
router.get("/link-details/:campaignId/:linkUrl", authenticate, async (req, res) => {
  try {
    const { campaignId, linkUrl } = req.params;
    const decodedUrl = decodeURIComponent(linkUrl);
    
    // Verify campaign belongs to user
    const campaign = await Campaign.findOne({ 
      _id: campaignId, 
      userId: req.user._id 
    });
    
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    // Get all tracking data for this specific link
    const linkData = await LinkTracking.find({ 
      campaignId, 
      originalUrl: decodedUrl 
    }).sort({ clickedAt: -1 });

    if (linkData.length === 0) {
      return res.status(404).json({ error: "Link not found in campaign" });
    }

    // Create timeline of all clicks
    const clickTimeline = [];
    linkData.forEach(link => {
      link.clickHistory.forEach(click => {
        clickTimeline.push({
          recipientEmail: link.recipientEmail,
          recipientName: link.recipientName,
          clickedAt: click.clickedAt,
          userAgent: click.userAgent,
          ipAddress: click.ipAddress,
          referer: click.referer
        });
      });
    });

    // Sort timeline by date
    clickTimeline.sort((a, b) => new Date(b.clickedAt) - new Date(a.clickedAt));

    // Get click statistics by day
    const clicksByDay = {};
    clickTimeline.forEach(click => {
      const date = click.clickedAt.toISOString().split('T')[0];
      clicksByDay[date] = (clicksByDay[date] || 0) + 1;
    });

    const dailyStats = Object.keys(clicksByDay).map(date => ({
      date,
      clicks: clicksByDay[date]
    })).sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({
      linkInfo: {
        originalUrl: decodedUrl,
        linkText: linkData[0].linkText,
        totalRecipients: linkData.length,
        uniqueClicks: linkData.filter(l => l.clicked).length,
        totalClicks: linkData.reduce((sum, l) => sum + l.clickCount, 0)
      },
      clickTimeline,
      dailyStats,
      recipients: linkData.map(link => ({
        email: link.recipientEmail,
        name: link.recipientName,
        clicked: link.clicked,
        clickCount: link.clickCount,
        firstClickAt: link.clickedAt,
        lastClickAt: link.lastClickedAt
      }))
    });

  } catch (error) {
    console.error('Error fetching link details:', error);
    res.status(500).json({ error: 'Failed to fetch link details' });
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

    // Check BASE_URL configuration
    const baseUrl = process.env.BASE_URL;
    if (!baseUrl) {
      console.warn('⚠️  BASE_URL environment variable not set. Tracking may not work properly.');
      console.log('💡 Set BASE_URL=https://vedive.com:3000 in your environment variables');
    } else {
      console.log(`✅ Using BASE_URL: ${baseUrl}`);
    }

    let recipientList = [];

    // Process recipients (your existing logic)
    if (req.file) {
      try {
        const { recipients } = await processUploadedFile(req.file.buffer, req.file.originalname);
        recipientList = recipients;
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
    } else if (contacts) {
      console.log("Processing contacts:", contacts);
      if (Array.isArray(contacts)) {
        recipientList = contacts.map(contact => {
          if (typeof contact === 'object' && contact.email) {
            return { email: contact.email, name: contact.name || null };
          }
          return { email: contact, name: null };
        });
      } else if (typeof contacts === "string" && contacts.trim()) {
        try {
          const parsedContacts = JSON.parse(contacts);
          if (Array.isArray(parsedContacts)) {
            recipientList = parsedContacts.map(contact => {
              if (typeof contact === 'object' && contact.email) {
                return { email: contact.email, name: contact.name || null };
              }
              return { email: contact, name: null };
            });
          } else {
            return res.status(400).json({ error: "Parsed contacts must be an array" });
          }
        } catch (error) {
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

    console.log(`📋 Processing ${recipientList.length} recipients`);

    // Validate email addresses
    const invalidContacts = recipientList.filter(contact => !isValidEmail(contact.email));
    if (invalidContacts.length > 0) {
      return res.status(400).json({
        message: "Invalid email addresses found",
        invalidContacts: invalidContacts.map(c => c.email),
      });
    }

    // Generate unique tracking tokens for each recipient
    const recipientsWithTracking = recipientList.map(recipient => ({
      email: recipient.email,
      name: recipient.name,
      trackingToken: crypto.randomBytes(32).toString('hex')
    }));

    console.log(`🎯 Generated tracking tokens for ${recipientsWithTracking.length} recipients`);

    // Create campaign
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
      recipients: recipientsWithTracking,
      status: "sending",
    });

    await newCampaign.save();
    console.log(`💾 Campaign created with ID: ${newCampaign._id}`);

    // Configure transporter
    const transporter = createAntiSpamTransporter(gmail, appPassword);

    // Verify transporter configuration
    try {
      await transporter.verify();
      console.log('✅ SMTP connection verified successfully');
    } catch (error) {
      console.error('❌ SMTP verification failed:', error);
      return res.status(400).json({ 
        message: "SMTP configuration error", 
        error: error.message 
      });
    }

    // Send emails with batching
    const results = [];
    const batchSize = 5;
    const delayBetweenEmails = 3000;
    const delayBetweenBatches = 60000;

    const emailContent = { gmail, from, subject, body };

    console.log(`🚀 Starting email sending process...`);

    for (let i = 0; i < recipientsWithTracking.length; i += batchSize) {
      const batch = recipientsWithTracking.slice(i, i + batchSize);
      const batchNumber = Math.floor(i/batchSize) + 1;
      
      console.log(`📦 Processing batch ${batchNumber} (${batch.length} emails)`);
      
      for (const recipient of batch) {
        const result = await sendEmailWithLinkTracking(recipient, transporter, emailContent, newCampaign);
        results.push(result);
        
        if (i + batch.indexOf(recipient) < recipientsWithTracking.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenEmails));
        }
      }
      
      if (i + batchSize < recipientsWithTracking.length) {
        console.log(`⏱️  Batch ${batchNumber} completed, waiting ${delayBetweenBatches/1000}s before next batch...`);
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }

    transporter.close();

    // Update campaign status
    const successfulResults = results.filter((r) => r.status === "success");
    const failedResults = results.filter((r) => r.status === "failed");
    
    newCampaign.status = failedResults.length === 0 ? "completed" : "partial";
    await newCampaign.save();

    console.log(`✅ Campaign completed: ${successfulResults.length} successful, ${failedResults.length} failed`);

    // Prepare response
    const response = {
      message: `Campaign completed: ${successfulResults.length}/${results.length} emails sent successfully`,
      campaignId: newCampaign._id,
      totalSent: successfulResults.length,
      totalFailed: failedResults.length,
      debugUrl: `${baseUrl}/api/debug-tracking/${newCampaign._id}`,
      results: results.map(r => ({
        email: r.contact,
        status: r.status,
        trackingId: r.trackingId,
        pixelUrl: r.pixelUrl,
        error: r.error
      }))
    };

    if (failedResults.length > 0) {
      return res.status(207).json({
        ...response,
        errors: failedResults
      });
    }

    res.status(200).json(response);

  } catch (error) {
    console.error("❌ Error in /send-gmail:", error.stack);
    res.status(500).json({ message: "Error sending emails", error: error.message });
  }
});

module.exports = router;