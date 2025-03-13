const express = require("express");
const router = express.Router();
const Campaign = require("../models/Campaign");
const { authenticate } = require("../middleware/authMiddleware");
const { scrapeEmails } = require("../services/scrapeService");
const { generateCSV } = require("../utils/csvWriter");
const pLimit = require("p-limit");
const fs = require("fs");
const validator = require("validator");
const path = require("path");

// Utility function to parse array fields
const parseArrayField = (field, fieldName) => {
  if (Array.isArray(field)) return field;
  if (typeof field === "string" && field.trim()) {
    try {
      const parsed = JSON.parse(field);
      if (!Array.isArray(parsed)) {
        throw new Error(`Parsed ${fieldName} must be an array`);
      }
      return parsed;
    } catch (error) {
      throw new Error(`Invalid ${fieldName} format. Must be a valid JSON array string.`);
    }
  }
  return [];
};

// Create a new campaign (generic creation endpoint)
router.post("/create-campaign", authenticate, async (req, res) => {
  try {
    console.log("Request body received for /create-campaign:", req.body);

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

    // Validate required fields
    if (!campaignName || !toolType) {
      return res.status(400).json({ error: "Missing required fields: campaignName and toolType" });
    }

    // Additional validation for email tools
    if ((toolType === "mail-sender" || toolType === "gmail-sender") && !fromEmail) {
      return res.status(400).json({ error: "fromEmail is required for mail-sender and gmail-sender tools" });
    }

    // Parse recipients
    let recipientList;
    try {
      recipientList = parseArrayField(recipients, "recipients");
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    // Parse scrapedNumbers
    let numbersList;
    try {
      numbersList = parseArrayField(scrapedNumbers, "scrapedNumbers");
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    // Validate email addresses if applicable
    if (
      (toolType === "mail-sender" || toolType === "gmail-sender") &&
      recipientList.length > 0 &&
      recipientList.some((email) => !validator.isEmail(email))
    ) {
      return res.status(400).json({ error: "Invalid email address found in recipients list" });
    }

    // Create a new campaign
    const newCampaign = new Campaign({
      userId: req.user._id,
      campaignName,
      toolType,
      smtpHost: smtpHost || "",
      smtpPort: smtpPort ? parseInt(smtpPort) : 587,
      smtpUsername: smtpUsername || "",
      smtpPassword: smtpPassword || "",
      fromEmail: fromEmail || "",
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
    console.error("Error in /create-campaign:", error);
    res.status(500).json({ error: "Failed to create campaign. Please try again." });
  }
});

// Fetch all campaigns for the authenticated user
router.get("/campaigns", authenticate, async (req, res) => {
  try {
    const campaigns = await Campaign.find({ userId: req.user._id })
      .select("-smtpPassword")
      .sort({ createdAt: -1 });
    res.status(200).json(campaigns);
  } catch (error) {
    console.error("Error in /campaigns:", error.message);
    res.status(500).json({ error: "Failed to fetch campaigns" });
  }
});

// API endpoint to scrape emails - FIXED BY ADDING AUTHENTICATE MIDDLEWARE
router.post("/scrape-emails", authenticate, async (req, res) => {
  try {
    const { query, pages = 2, domains, campaignName } = req.body;

    // Input validation
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Invalid or missing query parameter" });
    }
    if (!campaignName || typeof campaignName !== "string") {
      return res.status(400).json({ error: "Invalid or missing campaignName parameter" });
    }
    if (pages && (typeof pages !== "number" || pages <= 0)) {
      return res.status(400).json({ error: "Pages must be a positive number" });
    }
    if (domains && !Array.isArray(domains)) {
      return res.status(400).json({ error: "Domains must be an array" });
    }

    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ error: "User must be authenticated to create a campaign" });
    }

    // Move API keys to environment variables
    const apiKey = process.env.GOOGLE_API_KEY || "AIzaSyD_nVwEodt7Mg10vbXWEKXbMVLwBCVDfJI";
    const cx = process.env.GOOGLE_SEARCH_CX || "a0280e6e13d584edb";

    if (!apiKey || !cx) {
      return res.status(400).json({ error: "API key and CX (Custom Search Engine ID) are required" });
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

    const sites = req.body.sites || ["google.com", "instagram.com"];
    const limit = pLimit(1);

    const retryWithBackoff = async (fn, retries = 3, delay = 1000) => {
      try {
        return await fn();
      } catch (err) {
        if (retries > 0 && (err.response?.status === 429 || err.code === 'ECONNRESET')) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          return retryWithBackoff(fn, retries - 1, delay * 2);
        }
        throw err;
      }
    };

    const emailPromises = sites.map((site) =>
      limit(() =>
        retryWithBackoff(() =>
          scrapeEmails(`${query} (${domainQueries})`, [site], apiKey, cx, pages)
        )
      )
    );

    const emailResults = await Promise.all(emailPromises);
    const emails = [...new Set(emailResults.flat().filter(Boolean))]; // Remove duplicates

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

    // Generate CSV file with emails
    const csvPath = await generateCSV(emails.map(email => ({ email })));
    
    if (!csvPath) {
      return res.status(500).json({ error: "Failed to generate CSV file" });
    }

    // Send the file as a download
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename=emails-${Date.now()}.csv`);

    const fileStream = fs.createReadStream(csvPath);
    fileStream.pipe(res);
    
    // Clean up the file after sending
    fileStream.on('close', () => {
      fs.unlink(csvPath, (unlinkErr) => {
        if (unlinkErr) {
          console.error("Failed to delete file:", csvPath, unlinkErr);
        }
      });
    });
    
    fileStream.on('error', (err) => {
      console.error("File stream error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error streaming the file" });
      }
    });
  } catch (error) {
    console.error("Error in /scrape-emails:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "An error occurred during email scraping" });
    }
  }
});

module.exports = router;