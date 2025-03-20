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

// Utility function to parse array fields (if needed)
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

// API endpoint to scrape emails WITHOUT authentication
router.post("/scrape-emails", async (req, res) => {
  try {
    const { query, pages = 2, domains, campaignName, userId } = req.body;

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

    // Use userId from request body instead of authenticated user
    // If userId is not provided, use a default value (anonymous)
    const userIdentifier = userId || "anonymous";

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
    // Flatten and remove duplicates
    const emails = [...new Set(emailResults.flat().filter(Boolean))];

    if (emails.length === 0) {
      return res.status(404).json({ message: "No emails found for this query. Try different keywords or parameters." });
    }

    console.log(`Found ${emails.length} unique emails for query: "${query}"`);

    // Validate emails before saving
    const validEmails = emails.filter(email => validator.isEmail(email));
    if (validEmails.length === 0) {
      return res.status(404).json({ message: "No valid emails found for this query. Try different keywords or parameters." });
    }

    // Save the campaign if a valid userId is provided
    if (userId) {
      const newCampaign = new Campaign({
        userId: userIdentifier,
        campaignName,
        toolType: "email-scraper",
        query,
        recipients: validEmails,
        status: "completed",
      });
      await newCampaign.save();
      console.log(`Campaign created successfully with ID: ${newCampaign._id}`);
    } else {
      console.log("No userId provided, skipping campaign creation");
    }

    // Generate CSV file with the valid emails
    const csvPath = await generateCSV(validEmails.map(email => ({ email })));
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
    console.error("Error in /scrape-emails:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "An error occurred during email scraping" });
    }
  }
});

module.exports = router;
