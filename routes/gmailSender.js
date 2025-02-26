const express = require("express");
const router = express.Router();
const nodemailer = require("nodemailer");
const Campaign = require("../models/Campaign");
const { authenticate } = require("../middleware/authMiddleware");
const { scrapeEmails } = require("../services/scrapeService");
const { generateCSV } = require("../utils/csvWriter");
const pLimit = require("p-limit");
const fs = require("fs");

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

// Send Gmail emails
router.post("/send-gmail", authenticate, async (req, res) => {
  const { gmail, appPassword, from, subject, contacts, body, campaignName } = req.body;

  // Validate required fields
  if (!gmail || !appPassword || !from || !subject || !contacts || !body || !campaignName) {
    return res.status(400).json({ message: "All fields and campaign name are required" });
  }

  // Ensure contacts is an array
  let recipientList = [];
  console.log("Processing contacts:", contacts);
  if (Array.isArray(contacts)) {
    recipientList = contacts;
  } else if (typeof contacts === "string" && contacts.trim()) {
    try {
      recipientList = JSON.parse(contacts);
      if (!Array.isArray(recipientList)) {
        return res.status(400).json({ error: "Parsed contacts must be an array" });
      }
    } catch (error) {
      console.error("Failed to parse contacts:", contacts, "Error:", error.message);
      return res.status(400).json({ error: "Invalid contacts format. Expected a JSON array." });
    }
  } else {
    return res.status(400).json({ error: "Contacts must be provided as an array" });
  }

  // Validate email addresses
  const invalidContacts = recipientList.filter((contact) => !isValidEmail(contact));
  if (invalidContacts.length > 0) {
    return res.status(400).json({
      message: "Invalid email addresses found",
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
    for (let i = 0; i < recipientList.length; i++) {
      const result = await sendEmail(recipientList[i]);
      results.push(result);
      await new Promise((resolve) => setTimeout(resolve, 2000)); // 2-second delay
    }

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
      recipients: recipientList,
      status: results.every((r) => r.status === "success") ? "completed" : "failed",
    });

    await newCampaign.save();

    const failedEmails = results.filter((result) => result.status === "failed");
    if (failedEmails.length > 0) {
      return res.status(207).json({
        message: "Some emails failed to send",
        campaignId: newCampaign._id,
        errors: failedEmails,
      });
    }

    res.status(200).json({
      message: "All emails sent successfully",
      campaignId: newCampaign._id,
    });
  } catch (error) {
    console.error("Error in /send-gmail:", error.stack);
    res.status(500).json({ message: "Error sending emails", error: error.message });
  }
});

module.exports = router;