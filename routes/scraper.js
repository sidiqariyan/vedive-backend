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

// Improved retry mechanism with longer delays for rate limiting
const fetchWithRetry = async (url, retries = 3, delayMs = 5000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 15000
      });
    } catch (error) {
      if (error.response?.status === 429 && i < retries - 1) {
        console.log(`Rate limit hit. Retrying in ${delayMs}ms...`);
        await delay(delayMs);
        delayMs *= 2; // Exponential backoff
      } else if (i < retries - 1) {
        console.log(`Request failed (${error.response?.status || error.code}). Retrying in ${delayMs}ms...`);
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
 * Alternative scraping methods when priv.au is rate-limiting
 */
async function scrapeWithAlternativeMethods(query, sites, pagesToScraper = 3) {
  console.log("Using alternative scraping methods due to rate limiting...");
  const emails = new Set();
  const emailRegex = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
  
  // Method 1: Direct site search (if sites have search functionality)
  for (const site of sites) {
    try {
      console.log(`Attempting direct search on ${site}...`);
      
      // For LinkedIn, try their search functionality
      if (site.includes('linkedin.com')) {
        const linkedinSearchUrl = `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(query)}`;
        try {
          const response = await fetchWithRetry(linkedinSearchUrl, 2, 8000);
          const found = response.data.match(emailRegex) || [];
          const filtered = filterEmails(found);
          console.log(`→ Found ${filtered.length} emails from LinkedIn direct search`);
          filtered.forEach(e => emails.add(e));
        } catch (err) {
          console.log(`LinkedIn direct search failed: ${err.message}`);
        }
      }
      
      // Add delay between site attempts
      await delay(3000);
      
    } catch (error) {
      console.error(`Error with alternative method for ${site}:`, error.message);
    }
  }
  
  return Array.from(emails);
}

/**
 * Scrape search results from priv.au with improved rate limiting handling
 */
async function scrapePrivAuResults(query, sites, pagesToScrape = 2) {
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
        
        // Longer delay before each request to avoid rate limiting
        if (page > 1 || searchResults.length > 0) {
          await delay(8000); // 8 second delay between requests
        }
        
        const response = await fetchWithRetry(searchUrl, 2, 10000);
        const html = response.data;
        
        // Extract search result links from priv.au HTML
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
          .slice(0, 5); // Reduce to 5 results per page to be more conservative
        
        console.log(`→ Found ${pageResults.length} results on page ${page}`);
        searchResults.push(...pageResults);
        
      } catch (error) {
        console.error(`Error fetching page ${page} for site ${site}:`, error.message);
        
        // If we hit rate limiting, try alternative methods
        if (error.response?.status === 429) {
          console.log("Rate limiting detected, falling back to alternative methods...");
          const altResults = await scrapeWithAlternativeMethods(query, [site], 1);
          return altResults;
        }
        break;
      }
    }
    
    // Longer delay between different sites
    await delay(10000);
  }
  
  return [...new Set(searchResults)]; // Remove duplicates
}

/**
 * Main function to scrape emails using priv.au search with fallbacks
 */
async function scrapeEmails(query, sites, pagesToScrape = 2) {
  console.log("Starting email scraping with priv.au...");
  const emails = new Set();
  const emailRegex = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
  const puppeteerLinks = [];
  
  try {
    // Get search results from priv.au
    const searchResults = await scrapePrivAuResults(query, sites, pagesToScrape);
    console.log(`Total unique URLs found: ${searchResults.length}`);
    
    // If no results from priv.au, try alternative methods
    if (searchResults.length === 0) {
      console.log("No results from priv.au, trying alternative methods...");
      const altEmails = await scrapeWithAlternativeMethods(query, sites, pagesToScrape);
      altEmails.forEach(e => emails.add(e));
      return Array.from(emails);
    }
    
    // Process each URL with longer delays
    for (const link of searchResults.slice(0, 10)) { // Limit to 10 URLs total
      console.log(`Processing: ${link}`);
      
      // Check if this is a site that needs Puppeteer
      if (sites.some(site => site.includes("instagram.com") || site.includes("facebook.com")) && 
          (link.includes("instagram.com") || link.includes("facebook.com"))) {
        puppeteerLinks.push(link);
      } else {
        try {
          // Longer delay between page visits
          await delay(3000);
          
          const response = await axios.get(link, { 
            timeout: 12000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
          if (puppeteerLinks.length < 5) { // Limit puppeteer links
            puppeteerLinks.push(link);
          }
        }
      }
    }
    
    // Use Puppeteer for remaining links (limited)
    if (puppeteerLinks.length > 0) {
      console.log(`Using Puppeteer for ${puppeteerLinks.length} remaining links...`);
      const puppeteerEmails = await scrapeEmailsWithPuppeteer(puppeteerLinks.slice(0, 5));
      puppeteerEmails.forEach((e) => emails.add(e));
    }
    
  } catch (error) {
    console.error("Error in email scraping:", error);
    
    // Final fallback - try alternative methods
    console.log("Attempting final fallback methods...");
    const fallbackEmails = await scrapeWithAlternativeMethods(query, sites, 1);
    fallbackEmails.forEach(e => emails.add(e));
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
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });
    
    for (const link of links.slice(0, 5)) { // Limit to first 5 links for performance
      try {
        console.log(`Puppeteer visiting: ${link}`);
        
        await page.goto(link, { 
          waitUntil: "domcontentloaded", 
          timeout: 20000 
        });
        
        // Wait a bit for dynamic content
        await delay(3000);
        
        const content = await page.content();
        const found = content.match(/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g) || [];
        const filtered = filterEmails(found);
        
        console.log(`  → Puppeteer found ${filtered.length} valid emails`);
        filtered.forEach((e) => emails.add(e));
        
        // Add longer delay between pages
        await delay(5000);
        
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
    const { query, pages = 2, domains, campaignName, userId } = req.body;

    // Input validation
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Invalid or missing query parameter" });
    }
    if (!campaignName || typeof campaignName !== "string") {
      return res.status(400).json({ error: "Invalid or missing campaignName parameter" });
    }
    if (pages && (typeof pages !== "number" || pages <= 0 || pages > 5)) {
      return res.status(400).json({ error: "Pages must be a positive number between 1 and 5" });
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

    console.log(`Starting email scraping for query: "${query}" with domains: ${domainQueries}`);
    
    // Create the full search query including domain filters
    const fullQuery = `${query} (${domainQueries})`;
    
    // Scrape emails using priv.au with improved handling
    const emails = await scrapeEmails(fullQuery, sites, pages);

    if (emails.length === 0) {
      return res.status(404).json({ 
        message: "No emails found for this query. The service may be experiencing rate limiting. Try again later or use different keywords." 
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

// FIXED: Match the frontend endpoint path
router.post("/email-scraper", async (req, res) => {
  return await handleEmailScraper(req, res);
});

// Keep the original endpoint as well for backward compatibility
router.post("/scrape-emails", async (req, res) => {
  return await handleEmailScraper(req, res);
});

// Export both the router and the handler function
module.exports = router;
module.exports.handleEmailScraper = handleEmailScraper;
