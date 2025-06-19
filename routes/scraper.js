const express = require("express");
const router = express.Router();
const Campaign = require("../models/Campaign");
const fs = require("fs");
const path = require("path");
const validator = require("validator");
const pLimit = require("p-limit");

// Import the email scraping service and CSV generator utility
const { scrapeEmails } = require("../services/scrapeService");
const { generateCSV } = require("../utils/csvWriter");

// Handler function for email scraper that can be used by multiple routes
const handleEmailScraper = async (req, res) => {
  try {
    const { query, pages = 3, domains, campaignName, userId } = req.body;

    // Input validation
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Invalid or missing query parameter" });
    }
    if (!campaignName || typeof campaignName !== "string") {
      return res.status(400).json({ error: "Invalid or missing campaignName parameter" });
    }
    if (pages && (typeof pages !== "number" || pages <= 0 || pages > 10)) {
      return res.status(400).json({ error: "Pages must be a positive number between 1 and 10" });
    }
    if (domains && !Array.isArray(domains)) {
      return res.status(400).json({ error: "Domains must be an array" });
    }

    // Use userId from authenticated user or from request body
    const userIdentifier = req.user?._id || userId || "anonymous";

    // Get API keys from environment variables
    const apiKey = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_SEARCH_CX;
    if (!apiKey || !cx) {
      return res.status(500).json({ error: "Search service configuration is missing" });
    }

    // Set default and custom domains
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

    // Define sites to search from (defaulting to Google and Instagram)
    const sites = req.body.sites || ["google.com", "instagram.com"];

    // Limit concurrent requests to avoid rate limiting
    const limit = pLimit(1);

    // Helper function: retry with exponential backoff
    const retryWithBackoff = async (fn, retries = 3, delay = 1000) => {
      try {
        return await fn();
      } catch (err) {
        if (retries > 0 && (err.response?.status === 429 || err.code === "ECONNRESET")) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          return retryWithBackoff(fn, retries - 1, delay * 2);
        }
        throw err;
      }
    };

    console.log(`Starting email scraping for query: "${query}" with domains: ${domainQueries}`);
    
    // Create promises for scraping emails from each site
    const emailPromises = sites.map((site) =>
      limit(() =>
        retryWithBackoff(() =>
          scrapeEmails(`${query} (${domainQueries})`, [site], apiKey, cx, pages)
        )
      )
    );

    const emailResults = await Promise.all(emailPromises);
    
    // Flatten results and handle duplicates while preserving enhanced data
    const emailMap = new Map();
    emailResults.flat().forEach(item => {
      if (item && item.email) {
        // If email doesn't exist, add it. If it exists, keep the first one found
        if (!emailMap.has(item.email)) {
          emailMap.set(item.email, item);
        }
      }
    });

    // Convert back to array of enhanced email objects
    const emailsWithEnhancedData = Array.from(emailMap.values());

    if (emailsWithEnhancedData.length === 0) {
      return res.status(404).json({ message: "No emails found for this query. Try different keywords or parameters." });
    }

    console.log(`Found ${emailsWithEnhancedData.length} unique emails for query: "${query}"`);

    // Validate emails before saving
    const validEmailsWithData = emailsWithEnhancedData.filter(item => validator.isEmail(item.email));
    if (validEmailsWithData.length === 0) {
      return res.status(404).json({ message: "No valid emails found for this query. Try different keywords or parameters." });
    }

    // Transform emails to the format expected by Campaign model
    const recipientsForCampaign = validEmailsWithData.map(item => ({
      email: item.email,
      source: item.source || 'unknown',
      // Add other fields that your Campaign model expects
      status: 'pending',
      // If your enhanced scraper returns validation data, include it
      ...(item.validation && {
        validationScore: item.validation.validationScore,
        riskLevel: item.validation.riskLevel,
        confidence: item.validation.confidence
      }),
      // If context is available
      ...(item.context && { context: item.context }),
      // Add any other fields from your enhanced scraper
      foundAt: item.foundAt || new Date().toISOString(),
      scrapingMethod: item.scrapingMethod || 'HTTP'
    }));

    // Save the campaign
    if (userIdentifier && userIdentifier !== "anonymous") {
      const newCampaign = new Campaign({
        userId: userIdentifier,
        campaignName,
        toolType: "email-scraper",
        query,
        recipients: recipientsForCampaign, // Now it's an array of objects
        status: "completed",
      });
      await newCampaign.save();
      console.log(`Campaign created successfully with ID: ${newCampaign._id}`);
    } else {
      console.log("No userId provided, skipping campaign creation");
    }

    // Generate CSV file with the valid emails and their sources
    // For CSV, we can use a simplified format
    const emailsForCSV = validEmailsWithData.map(item => ({
      email: item.email,
      source: item.source || 'unknown',
      validationScore: item.validation?.validationScore || 0,
      riskLevel: item.validation?.riskLevel || 'unknown',
      foundAt: item.foundAt || new Date().toISOString()
    }));

    const csvPath = await generateCSV(emailsForCSV);
    if (!csvPath) {
      return res.status(500).json({ error: "Failed to generate CSV file" });
    }

    // Set response headers for file download
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename=emails-${Date.now()}.csv`);

    const fileStream = fs.createReadStream(csvPath);
    fileStream.pipe(res);
    
    // Clean up file after streaming
    fileStream.on("close", () => {
      fs.unlink(csvPath, (unlinkErr) => {
        if (unlinkErr) {
          console.error("Failed to delete file:", csvPath, unlinkErr);
        }
      });
    });
    
    fileStream.on("error", (err) => {
      console.error("File stream error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error streaming the file" });
      }
    });
  } catch (error) {
    console.error("Error in email scraper:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "An error occurred during email scraping" });
    }
  }
};

// API endpoint to scrape emails WITHOUT authentication
router.post("/scrape-emails", async (req, res) => {
  return await handleEmailScraper(req, res);
});

// Export both the router and the handler function
module.exports = router;
module.exports.handleEmailScraper = handleEmailScraper;