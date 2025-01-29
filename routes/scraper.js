const express = require("express");
const { scrapeEmails } = require("../services/scrapeService");
const { generateCSV } = require("../utils/csvWriter");
const pLimit = require("p-limit"); // Add rate limiting

const router = express.Router();

router.post("/", async (req, res) => {
  const query = req.body.query || "contact email"; // Allow dynamic query input
  const pages = req.body.pages || 2; // Allow dynamic page input
  const customDomains = req.body.domains || []; // Allow user to add custom domains
  const apiKey = "AIzaSyD_nVwEodt7Mg10vbXWEKXbMVLwBCVDfJI"; // Google API key provided by the user
  const cx = "a0280e6e13d584edb"; // Google Custom Search Engine ID

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

  const domains = [...new Set([...defaultDomains, ...customDomains])];
  const domainQueries = domains.map((d) => `"${d}"`).join(" OR ");

  if (!query) {
    return res.status(400).json({ error: "Query is required" });
  }

  try {
    console.log("Scraping process started...");
    const sites = req.body.sites || ["google.com", "instagram.com"];
    
    const limit = pLimit(1); // Allow only 1 request at a time
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

    const csvPath = await generateCSV(emails);

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", "attachment; filename=emails.csv");
    res.sendFile(csvPath, (err) => {
      if (err) {
        console.error("Error in downloading file:", err);
        return res.status(500).json({ error: "Error downloading the file." });
      }
    });
  } catch (error) {
    console.error("Error during scraping:", error);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

module.exports = router;
