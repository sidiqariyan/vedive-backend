const express = require("express");
const { scrapeEmails } = require("../services/scrapeService");
const { generateCSV } = require("../utils/csvWriter");
const pLimit = require("p-limit"); // Add rate limiting
const mongoose = require("mongoose");
const fs = require("fs");
const Campaign = require("../models/Campaign"); // Import the Campaign model
const { authenticate } = require("../middleware/authMiddleware"); // Import authentication middleware
const router = express.Router();

// API endpoint to scrape emails
router.post("/", authenticate, async (req, res) => {
  const { query, pages, domains, campaignName } = req.body;

  // Validate required fields
  if (!query || !campaignName) {
    return res.status(400).json({ error: "Query and Campaign Name are required" });
  }

  // Extract userId from the authenticated user
  const userId = req.user?._id;
  if (!userId) {
    return res.status(401).json({ error: "User must be authenticated to create a campaign." });
  }

  const apiKey = "AIzaSyD_nVwEodt7Mg10vbXWEKXbMVLwBCVDfJI"; // Google API key provided by the user
  const cx = "a0280e6e13d584edb"; // Google Custom Search Engine ID
  if (!apiKey || !cx) {
    return res.status(400).json({ error: "API key and CX (Custom Search Engine ID) are required" });
  }

  // Define default email domains
  const defaultDomains = [
    "@gmail.com", "@yahoo.com", "@hotmail.com", "@icloud.com",
    "@aol.com", "@email.com", "@protonmail.com", "@zoho.com",
    "@gmx.com", "@mail.com", "@yandex.com", "@tutanota.com",
    "@fastmail.com", "@sendgrid.com", "@bluehost.com",
    "@qmail.com", "@inbox.com",
  ];

  // Merge default domains with custom domains (if provided)
  const customDomains = domains || [];
  const allDomains = [...new Set([...defaultDomains, ...customDomains])];
  const domainQueries = allDomains.map((d) => `"${d}"`).join(" OR ");

  try {
    console.log("Scraping process started...");

    // Define sites to scrape (default or user-provided)
    const sites = req.body.sites || ["google.com", "instagram.com"];

    // Rate limit to avoid hitting API limits
    const limit = pLimit(1); // Allow only 1 request at a time

    // Scrape emails from each site
    const emailPromises = sites.map((site) =>
      limit(() =>
        scrapeEmails(`${query} (${domainQueries})`, [site], apiKey, cx, pages).catch((err) => {
          if (err.response && err.response.status === 429) {
            console.error(`Rate limit hit for site: ${site}. Retrying with backoff.`);
            return null; // Handle retries if necessary
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

    // Save campaign data to MongoDB
    const newCampaign = new Campaign({
      userId, // Include the authenticated user's ID
      campaignName,
      toolType: "email-scraper", // Static name for the Email Scraper tool
      query,
      domains: allDomains,
      scrapedEmails: emails,
    });

    await newCampaign.save();

    // Generate CSV file
    const csvPath = await generateCSV(emails);

    // Send CSV file as a response
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", "attachment; filename=emails.csv");
    res.sendFile(csvPath, (err) => {
      if (err) {
        console.error("Error in downloading file:", err);
        return res.status(500).json({ error: "Error downloading the file." });
      }

      // Clean up the generated CSV file after sending it
      fs.unlinkSync(csvPath);
    });
  } catch (error) {
    console.error("Error during scraping:", error);
    res.status(500).json({ error: error.message }); // Return the error message as JSON
  }
});

module.exports = router;