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
const fetchWithRetry = async (url, retries = 3, delayMs = 3000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
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
 * Alternative search engines that are less likely to block requests
 */
const searchEngines = [
  {
    name: 'DuckDuckGo',
    url: (query) => `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    resultSelector: '.result__a',
    linkAttribute: 'href'
  },
  {
    name: 'Searx',
    url: (query) => `https://searx.be/search?q=${encodeURIComponent(query)}&format=html`,
    resultSelector: '.result h3 a',
    linkAttribute: 'href'
  },
  {
    name: 'Startpage',
    url: (query) => `https://www.startpage.com/do/dsearch?query=${encodeURIComponent(query)}&cat=web&pl=opensearch`,
    resultSelector: '.w-gl__result-title',
    linkAttribute: 'href'
  },
  {
    name: 'Yandex',
    url: (query) => `https://yandex.com/search/?text=${encodeURIComponent(query)}&lr=84`,
    resultSelector: '.organic__url',
    linkAttribute: 'href'
  }
];

/**
 * Direct site search methods for specific platforms
 */
async function searchDirectSites(query, sites) {
  console.log("Attempting direct site searches...");
  const emails = new Set();
  const urls = new Set();
  const emailRegex = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

  for (const site of sites) {
    try {
      console.log(`Direct search on ${site}...`);
      
      // Method 1: Try site's internal search if available
      if (site.includes('linkedin.com')) {
        const linkedinUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`;
        urls.add(linkedinUrl);
      } else if (site.includes('twitter.com') || site.includes('x.com')) {
        const twitterUrl = `https://twitter.com/search?q=${encodeURIComponent(query)}&src=typed_query`;
        urls.add(twitterUrl);
      } else if (site.includes('github.com')) {
        const githubUrl = `https://github.com/search?q=${encodeURIComponent(query)}&type=users`;
        urls.add(githubUrl);
      } else {
        // Generic site search
        const siteUrl = `https://${site}/search?q=${encodeURIComponent(query)}`;
        urls.add(siteUrl);
      }
      
      await delay(2000);
      
    } catch (error) {
      console.error(`Error with direct search for ${site}:`, error.message);
    }
  }

  return Array.from(urls);
}

/**
 * Search using alternative search engines
 */
async function searchWithAlternativeEngines(query, sites, pagesToScrape = 2) {
  console.log("Using alternative search engines...");
  const searchResults = new Set();
  const emailRegex = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

  for (const site of sites) {
    const siteQuery = `site:${site} ${query}`;
    
    for (const engine of searchEngines) {
      try {
        console.log(`Searching ${engine.name} for: ${siteQuery}`);
        
        const searchUrl = engine.url(siteQuery);
        await delay(3000); // Delay between requests
        
        const response = await fetchWithRetry(searchUrl, 2, 5000);
        const html = response.data;
        
        // Extract URLs from search results
        const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
        const matches = [...html.matchAll(linkRegex)];
        
        const results = matches
          .map(match => match[1])
          .filter(link => {
            return link.startsWith('http') && 
                   !link.includes(engine.name.toLowerCase()) &&
                   sites.some(s => link.includes(s));
          })
          .slice(0, 5);
        
        console.log(`→ ${engine.name} found ${results.length} results`);
        results.forEach(url => searchResults.add(url));
        
        // Also check for emails directly in search results
        const directEmails = html.match(emailRegex) || [];
        const filteredDirectEmails = filterEmails(directEmails);
        console.log(`→ ${engine.name} found ${filteredDirectEmails.length} direct emails`);
        
        break; // Move to next site after successful search
        
      } catch (error) {
        console.error(`Error with ${engine.name}:`, error.message);
        // Continue to next search engine
        continue;
      }
    }
    
    await delay(4000); // Delay between sites
  }
  
  return Array.from(searchResults);
}

/**
 * Scrape emails from GitHub (public repositories and profiles)
 */
async function scrapeGitHubEmails(query) {
  console.log("Scraping GitHub for emails...");
  const emails = new Set();
  const emailRegex = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
  
  try {
    // Search GitHub users
    const userSearchUrl = `https://api.github.com/search/users?q=${encodeURIComponent(query)}&per_page=10`;
    await delay(2000);
    
    const userResponse = await fetchWithRetry(userSearchUrl, 2, 3000);
    const users = userResponse.data.items || [];
    
    for (const user of users.slice(0, 5)) {
      try {
        await delay(1000);
        const userUrl = `https://api.github.com/users/${user.login}`;
        const userDetails = await fetchWithRetry(userUrl, 2, 3000);
        
        if (userDetails.data.email && validator.isEmail(userDetails.data.email)) {
          emails.add(userDetails.data.email);
          console.log(`→ Found GitHub email: ${userDetails.data.email}`);
        }
      } catch (err) {
        console.error(`Error fetching user ${user.login}:`, err.message);
      }
    }
    
    // Search repositories for emails in commits
    const repoSearchUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=5`;
    await delay(2000);
    
    const repoResponse = await fetchWithRetry(repoSearchUrl, 2, 3000);
    const repos = repoResponse.data.items || [];
    
    for (const repo of repos.slice(0, 3)) {
      try {
        await delay(1000);
        const commitsUrl = `https://api.github.com/repos/${repo.full_name}/commits?per_page=10`;
        const commitsResponse = await fetchWithRetry(commitsUrl, 2, 3000);
        const commits = commitsResponse.data || [];
        
        commits.forEach(commit => {
          if (commit.commit?.author?.email && validator.isEmail(commit.commit.author.email)) {
            emails.add(commit.commit.author.email);
          }
          if (commit.commit?.committer?.email && validator.isEmail(commit.commit.committer.email)) {
            emails.add(commit.commit.committer.email);
          }
        });
        
      } catch (err) {
        console.error(`Error fetching commits for ${repo.full_name}:`, err.message);
      }
    }
    
  } catch (error) {
    console.error("GitHub API error:", error.message);
  }
  
  const filteredEmails = filterEmails(Array.from(emails));
  console.log(`→ GitHub search found ${filteredEmails.length} valid emails`);
  return filteredEmails;
}

/**
 * Scrape emails from Reddit (public posts and comments)
 */
async function scrapeRedditEmails(query) {
  console.log("Scraping Reddit for emails...");
  const emails = new Set();
  const emailRegex = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
  
  try {
    const searchUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=20&sort=relevance`;
    await delay(2000);
    
    const response = await fetchWithRetry(searchUrl, 2, 3000);
    const posts = response.data?.data?.children || [];
    
    for (const post of posts.slice(0, 10)) {
      try {
        const postData = post.data;
        
        // Check post title and text
        const textContent = `${postData.title || ''} ${postData.selftext || ''}`;
        const foundEmails = textContent.match(emailRegex) || [];
        const filteredEmails = filterEmails(foundEmails);
        
        filteredEmails.forEach(email => emails.add(email));
        
        await delay(500);
        
      } catch (err) {
        console.error(`Error processing Reddit post:`, err.message);
      }
    }
    
  } catch (error) {
    console.error("Reddit API error:", error.message);
  }
  
  const finalEmails = filterEmails(Array.from(emails));
  console.log(`→ Reddit search found ${finalEmails.length} valid emails`);
  return finalEmails;
}

/**
 * Main function to scrape emails using multiple alternative sources
 */
async function scrapeEmails(query, sites, pagesToScrape = 2) {
  console.log("Starting email scraping with alternative sources...");
  const emails = new Set();
  const emailRegex = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
  const allUrls = new Set();
  
  try {
    // Method 1: Use alternative search engines
    const searchUrls = await searchWithAlternativeEngines(query, sites, pagesToScrape);
    searchUrls.forEach(url => allUrls.add(url));
    
    // Method 2: Direct site searches
    const directUrls = await searchDirectSites(query, sites);
    directUrls.forEach(url => allUrls.add(url));
    
    // Method 3: GitHub API search
    if (sites.includes('github.com') || sites.length === 0) {
      const githubEmails = await scrapeGitHubEmails(query);
      githubEmails.forEach(email => emails.add(email));
    }
    
    // Method 4: Reddit search
    if (sites.includes('reddit.com') || sites.length === 0) {
      const redditEmails = await scrapeRedditEmails(query);
      redditEmails.forEach(email => emails.add(email));
    }
    
    console.log(`Total URLs to process: ${allUrls.size}`);
    
    // Process collected URLs
    const urlArray = Array.from(allUrls).slice(0, 15); // Limit to 15 URLs
    const puppeteerUrls = [];
    
    for (const url of urlArray) {
      console.log(`Processing: ${url}`);
      
      // Check if this URL needs Puppeteer (social media sites)
      if (url.includes("instagram.com") || 
          url.includes("facebook.com") || 
          url.includes("twitter.com") ||
          url.includes("linkedin.com")) {
        puppeteerUrls.push(url);
      } else {
        try {
          await delay(2000);
          
          const response = await axios.get(url, {
            timeout: 10000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          });
          
          const html = response.data;
          const found = html.match(emailRegex) || [];
          const filtered = filterEmails(found);
          
          console.log(`  → Found ${filtered.length} valid emails`);
          filtered.forEach(email => emails.add(email));
          
        } catch (err) {
          console.error(`  → Error visiting ${url}: ${err.message}`);
          // Add to puppeteer queue as fallback
          if (puppeteerUrls.length < 8) {
            puppeteerUrls.push(url);
          }
        }
      }
    }
    
    // Use Puppeteer for social media and failed URLs
    if (puppeteerUrls.length > 0) {
      console.log(`Using Puppeteer for ${puppeteerUrls.length} URLs...`);
      const puppeteerEmails = await scrapeEmailsWithPuppeteer(puppeteerUrls.slice(0, 8));
      puppeteerEmails.forEach(email => emails.add(email));
    }
    
  } catch (error) {
    console.error("Error in email scraping:", error);
  }
  
  console.log(`Total unique emails found: ${emails.size}`);
  return Array.from(emails);
}

// Puppeteer fallback for sites like Instagram, Facebook, Twitter, LinkedIn
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
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor"
      ],
    });
    
    const page = await browser.newPage();
    
    // Set user agent and viewport
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });
    
    // Block images and CSS to speed up loading
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if(req.resourceType() == 'stylesheet' || req.resourceType() == 'image'){
        req.abort();
      } else {
        req.continue();
      }
    });
    
    for (const link of links.slice(0, 5)) {
      try {
        console.log(`Puppeteer visiting: ${link}`);
        
        await page.goto(link, { 
          waitUntil: "domcontentloaded", 
          timeout: 25000 
        });
        
        // Wait for dynamic content
        await delay(4000);
        
        const content = await page.content();
        const found = content.match(/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g) || [];
        const filtered = filterEmails(found);
        
        console.log(`  → Puppeteer found ${filtered.length} valid emails`);
        filtered.forEach(email => emails.add(email));
        
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

    // Define sites to search from - expanded list
    const sites = req.body.sites || [
      "github.com", "reddit.com", "twitter.com", "linkedin.com", 
      "instagram.com", "facebook.com", "medium.com", "dev.to"
    ];

    console.log(`Starting email scraping for query: "${query}" with domains: ${domainQueries}`);
    
    // Create the full search query including domain filters
    const fullQuery = `${query} (${domainQueries})`;
    
    // Scrape emails using alternative sources
    const emails = await scrapeEmails(fullQuery, sites, pages);

    if (emails.length === 0) {
      return res.status(404).json({ 
        message: "No emails found for this query. Try using different keywords, sites, or search terms." 
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
