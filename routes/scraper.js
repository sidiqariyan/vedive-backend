const express = require("express");
const router = express.Router();
const Campaign = require("../models/Campaign");
const fs = require("fs");
const path = require("path");
const validator = require("validator");
const pLimit = require("p-limit");
const axios = require("axios");
const puppeteer = require("puppeteer");

// Import the CSV generator utility
const { generateCSV } = require("../utils/csvWriter");

// Utility function for delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retry mechanism with exponential backoff
const fetchWithRetry = async (url, retries = 3, delayMs = 2000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        timeout: 10000
      });
    } catch (error) {
      if (error.response?.status === 429 && i < retries - 1) {
        console.log(`Rate limit hit. Retrying in ${delayMs}ms...`);
        await delay(delayMs);
        delayMs *= 2;
      } else if (i < retries - 1) {
        console.log(`Request failed. Retrying in ${delayMs}ms...`);
        await delay(delayMs);
        delayMs *= 1.5;
      } else {
        throw error;
      }
    }
  }
};

// Return true if this email should be excluded
const isExcludedEmail = (email) => {
  const [local, domain] = email.toLowerCase().split("@");
  
  // 1) anything at google.com or googlegroups.com
  if (/(^|\.)google\.com$/.test(domain) || /(^|\.)googlegroups\.com$/.test(domain)) {
    return true;
  }
  
  // 2) anything containing literal angle brackets
  if (email.includes("<") || email.includes(">")) {
    return true;
  }
  
  // 3) "malformed" local parts like 10.3617… or u003c… pattern
  if (/^(?:u003c|\d+\.\d+)/.test(local)) {
    return true;
  }
  
  // 4) Common system/automated emails to exclude
  const excludedPatterns = [
    /^no-?reply@/i,
    /^support@/i,
    /^info@/i,
    /^admin@/i,
    /^webmaster@/i,
    /^postmaster@/i
  ];
  
  return excludedPatterns.some(pattern => pattern.test(email));
};

// Filter an array of emails
const filterEmails = (candidates) =>
  candidates.filter((e) => !isExcludedEmail(e));

/**
 * Scrape search results from priv.au
 */
async function scrapePrivAuResults(query, sites, pagesToScrape = 3) {
  console.log("Starting priv.au search scraping...");
  const searchResults = [];
  
  for (const site of sites) {
    console.log(`Searching priv.au for site: ${site}`);
    
    for (let page = 1; page <= pagesToScrape; page++) {
      try {
        // Construct the search URL for priv.au
        const searchQuery = `site:${site} ${query}`;
        const searchUrl = `https://priv.au/search?q=${encodeURIComponent(searchQuery)}&page=${page}`;
        
        console.log(`Fetching page ${page}: ${searchUrl}`);
        
        const response = await fetchWithRetry(searchUrl);
        const html = response.data;
        
        // Extract search result links from priv.au HTML
        // This regex looks for typical search result link patterns
        const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
        const matches = [...html.matchAll(linkRegex)];
        
        const pageResults = matches
          .map(match => match[1])
          .filter(link => {
            // Filter for actual result links (not internal priv.au links)
            return link.startsWith('http') && 
                   !link.includes('priv.au') && 
                   link.includes(site);
          })
          .slice(0, 10); // Limit to first 10 results per page
        
        console.log(`→ Found ${pageResults.length} results on page ${page}`);
        searchResults.push(...pageResults);
        
        // Add delay between pages to be respectful
        await delay(2000);
        
      } catch (error) {
        console.error(`Error fetching page ${page} for site ${site}:`, error.message);
        break;
      }
    }
  }
  
  return [...new Set(searchResults)]; // Remove duplicates
}

/**
 * Main function to scrape emails using priv.au search
 */
async function scrapeEmails(query, sites, pagesToScrape = 3) {
  console.log("Starting email scraping with priv.au...");
  const emails = new Set();
  const emailRegex = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
  const puppeteerLinks = [];
  
  try {
    // Get search results from priv.au
    const searchResults = await scrapePrivAuResults(query, sites, pagesToScrape);
    console.log(`Total unique URLs found: ${searchResults.length}`);
    
    // Process each URL
    for (const link of searchResults) {
      console.log(`Processing: ${link}`);
      
      // Check if this is a site that needs Puppeteer
      if (sites.some(site => site.includes("instagram.com") || site.includes("facebook.com")) && 
          (link.includes("instagram.com") || link.includes("facebook.com"))) {
        puppeteerLinks.push(link);
      } else {
        try {
          // Try to scrape with axios first
          const response = await axios.get(link, { 
            timeout: 8000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
          });
          
          const html = response.data;
          const found = html.match(emailRegex) || [];
          const filtered = filterEmails(found);
          
          console.log(`  → Found ${filtered.length} valid emails`);
          filtered.forEach((e) => emails.add(e));
          
        } catch (err) {
          console.error(`  → Error visiting ${link}: ${err.message}`);
          // If axios fails, add to puppeteer queue as fallback
          puppeteerLinks.push(link);
        }
      }
      
      // Add delay between requests to be respectful
      await delay(1000);
    }
    
    // Use Puppeteer for remaining links
    if (puppeteerLinks.length > 0) {
      console.log(`Using Puppeteer for ${puppeteerLinks.length} remaining links...`);
      const puppeteerEmails = await scrapeEmailsWithPuppeteer(puppeteerLinks);
      puppeteerEmails.forEach((e) => emails.add(e));
    }
    
  } catch (error) {
    console.error("Error in email scraping:", error);
  }
  
  console.log(`Total unique emails found: ${emails.size}`);
  return Array.from(emails);
}

// Puppeteer fallback for sites like Instagram or when axios fails
async function scrapeEmailsWithPuppeteer(links) {
  const emails = new Set();
  let browser;
  
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox", 
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-web-security"
      ],
    });
    
    const page = await browser.newPage();
    
    // Set user agent and viewport
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });
    
    for (const link of links.slice(0, 20)) { // Limit to first 20 links for performance
      try {
        console.log(`Puppeteer visiting: ${link}`);
        
        await page.goto(link, { 
          waitUntil: "domcontentloaded", 
          timeout: 15000 
        });
        
        // Wait a bit for dynamic content
        await delay(2000);
        
        const content = await page.content();
        const found = content.match(/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g) || [];
        const filtered = filterEmails(found);
        
        console.log(`  → Puppeteer found ${filtered.length} valid emails`);
        filtered.forEach((e) => emails.add(e));
        
        // Add delay between pages
        await delay(3000);
        
      } catch (err) {
        console.error(`  → Puppeteer error on ${link}: ${err.message}`);
      }
    }
  } catch (error) {
    console.error("Puppeteer setup error:", error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
  
  return Array.from(emails);
}

// Handler function for email scraper
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

    // Set default and custom domains for the search query
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

    // Define sites to search from
    const sites = req.body.sites || ["instagram.com", "twitter.com", "linkedin.com"];

    // Limit concurrent requests to avoid overwhelming the server
    const limit = pLimit(2);

    console.log(`Starting email scraping for query: "${query}" with domains: ${domainQueries}`);
    
    // Create the full search query including domain filters
    const fullQuery = `${query} (${domainQueries})`;
    
    // Scrape emails using priv.au
    const emails = await scrapeEmails(fullQuery, sites, pages);

    if (emails.length === 0) {
      return res.status(404).json({ 
        message: "No emails found for this query. Try different keywords or parameters." 
      });
    }

    console.log(`Found ${emails.length} unique emails for query: "${query}"`);

    // Validate emails before saving
    const validEmails = emails.filter(email => validator.isEmail(email));
    if (validEmails.length === 0) {
      return res.status(404).json({ 
        message: "No valid emails found for this query. Try different keywords or parameters." 
      });
    }

    // Save the campaign
    if (userIdentifier && userIdentifier !== "anonymous") {
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
    const csvPath = await generateCSV(validEmails);
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
