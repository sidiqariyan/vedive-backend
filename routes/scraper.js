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

// Concurrency limits for different operations
const searchLimit = pLimit(5); // 5 concurrent searches
const urlLimit = pLimit(10); // 10 concurrent URL visits
const apiLimit = pLimit(3); // 3 concurrent API calls

// Utility function for delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fast retry mechanism with shorter delays
const fetchWithRetry = async (url, retries = 2, delayMs = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
        },
        timeout: 8000,
        maxRedirects: 3
      });
    } catch (error) {
      if (i < retries - 1) {
        await delay(delayMs);
        delayMs *= 1.5;
      } else {
        throw error;
      }
    }
  }
};

// Enhanced email regex patterns
const emailPatterns = [
  /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
  /\b[A-Za-z0-9._%+\-]+\s*@\s*[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
  /\b[A-Za-z0-9._%+\-]+\s*\[\s*@\s*\]\s*[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
  /\b[A-Za-z0-9._%+\-]+\s*\(\s*@\s*\)\s*[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
  /\b[A-Za-z0-9._%+\-]+\s*\{\s*@\s*\}\s*[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g
];

// Return true if this email should be excluded
const isExcludedEmail = (email) => {
  if (!email || typeof email !== 'string') return true;
  
  // Clean up email
  email = email.replace(/\s+/g, '').replace(/[\[\](){}]/g, '').toLowerCase();
  
  if (!validator.isEmail(email)) return true;
  
  const [local, domain] = email.split("@");
  
  // Exclude common non-personal domains
  const excludedDomains = [
    'google.com', 'googlegroups.com', 'github.com', 'reddit.com',
    'facebook.com', 'twitter.com', 'linkedin.com', 'instagram.com',
    'youtube.com', 'amazon.com', 'microsoft.com', 'apple.com'
  ];
  
  if (excludedDomains.some(d => domain.includes(d))) return true;
  
  // Exclude system emails
  const excludedPatterns = [
    /^no-?reply@/i, /^support@/i, /^info@/i, /^admin@/i,
    /^webmaster@/i, /^postmaster@/i, /^help@/i, /^contact@/i,
    /^service@/i, /^team@/i, /^hello@/i, /^hi@/i
  ];
  
  return excludedPatterns.some(pattern => pattern.test(email));
};

// Extract emails from text using multiple patterns
const extractEmails = (text) => {
  const emails = new Set();
  
  emailPatterns.forEach(pattern => {
    const matches = text.match(pattern) || [];
    matches.forEach(email => {
      const cleaned = email.replace(/\s+/g, '').replace(/[\[\](){}]/g, '');
      if (!isExcludedEmail(cleaned)) {
        emails.add(cleaned.toLowerCase());
      }
    });
  });
  
  return Array.from(emails);
};

/**
 * Enhanced search engines with multiple pages
 */
const searchEngines = [
  {
    name: 'DuckDuckGo',
    baseUrl: 'https://duckduckgo.com/html/',
    searchUrl: (query, page = 1) => `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}&s=${(page-1)*10}`,
    maxPages: 5
  },
  {
    name: 'Searx',
    baseUrl: 'https://searx.be/search',
    searchUrl: (query, page = 1) => `https://searx.be/search?q=${encodeURIComponent(query)}&pageno=${page}&format=html`,
    maxPages: 5
  },
  {
    name: 'Startpage',
    baseUrl: 'https://www.startpage.com/do/dsearch',
    searchUrl: (query, page = 1) => `https://www.startpage.com/do/dsearch?query=${encodeURIComponent(query)}&page=${page}`,
    maxPages: 3
  },
  {
    name: 'Yandex',
    baseUrl: 'https://yandex.com/search/',
    searchUrl: (query, page = 1) => `https://yandex.com/search/?text=${encodeURIComponent(query)}&p=${page-1}`,
    maxPages: 5
  }
];

/**
 * Concurrent search across multiple engines and pages
 */
async function searchAllEngines(query, sites, maxPages = 3) {
  console.log(`Starting concurrent search across ${searchEngines.length} engines...`);
  const allResults = new Set();
  const allEmails = new Set();
  
  // Create search tasks for all engines and pages
  const searchTasks = [];
  
  for (const site of sites) {
    const siteQuery = `site:${site} ${query}`;
    
    for (const engine of searchEngines) {
      for (let page = 1; page <= Math.min(maxPages, engine.maxPages); page++) {
        searchTasks.push(
          searchLimit(async () => {
            try {
              const searchUrl = engine.searchUrl(siteQuery, page);
              console.log(`Searching ${engine.name} page ${page} for ${site}`);
              
              const response = await fetchWithRetry(searchUrl, 2, 500);
              const html = response.data;
              
              // Extract URLs
              const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
              const matches = [...html.matchAll(linkRegex)];
              
              const urls = matches
                .map(match => match[1])
                .filter(link => {
                  return link.startsWith('http') && 
                         !link.includes(engine.name.toLowerCase()) &&
                         sites.some(s => link.includes(s));
                })
                .slice(0, 10); // Top 10 results per page
              
              // Extract direct emails from search results
              const directEmails = extractEmails(html);
              console.log(`→ ${engine.name} p${page}: ${urls.length} URLs, ${directEmails.length} direct emails`);
              
              urls.forEach(url => allResults.add(url));
              directEmails.forEach(email => allEmails.add(email));
              
              return { urls, emails: directEmails };
              
            } catch (error) {
              console.error(`${engine.name} p${page} error:`, error.message);
              return { urls: [], emails: [] };
            }
          })
        );
      }
    }
  }
  
  // Execute all searches concurrently
  await Promise.all(searchTasks);
  
  console.log(`Search completed: ${allResults.size} URLs, ${allEmails.size} direct emails`);
  return {
    urls: Array.from(allResults),
    emails: Array.from(allEmails)
  };
}

/**
 * Enhanced GitHub API search
 */
async function scrapeGitHubEmailsConcurrent(query) {
  console.log("Starting concurrent GitHub search...");
  const emails = new Set();
  
  const githubTasks = [
    // Search users
    apiLimit(async () => {
      try {
        const userSearchUrl = `https://api.github.com/search/users?q=${encodeURIComponent(query)}&per_page=50`;
        const response = await fetchWithRetry(userSearchUrl, 2, 1000);
        const users = response.data.items || [];
        
        const userTasks = users.slice(0, 20).map(user => 
          apiLimit(async () => {
            try {
              const userUrl = `https://api.github.com/users/${user.login}`;
              const userDetails = await fetchWithRetry(userUrl, 2, 500);
              if (userDetails.data.email && !isExcludedEmail(userDetails.data.email)) {
                emails.add(userDetails.data.email.toLowerCase());
              }
            } catch (err) {
              console.error(`Error fetching user ${user.login}:`, err.message);
            }
          })
        );
        
        await Promise.all(userTasks);
        console.log(`→ GitHub users: ${emails.size} emails`);
        
      } catch (error) {
        console.error("GitHub user search error:", error.message);
      }
    }),
    
    // Search repositories
    apiLimit(async () => {
      try {
        const repoSearchUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=30`;
        const response = await fetchWithRetry(repoSearchUrl, 2, 1000);
        const repos = response.data.items || [];
        
        const repoTasks = repos.slice(0, 10).map(repo =>
          apiLimit(async () => {
            try {
              const commitsUrl = `https://api.github.com/repos/${repo.full_name}/commits?per_page=50`;
              const commitsResponse = await fetchWithRetry(commitsUrl, 2, 500);
              const commits = commitsResponse.data || [];
              
              commits.forEach(commit => {
                if (commit.commit?.author?.email && !isExcludedEmail(commit.commit.author.email)) {
                  emails.add(commit.commit.author.email.toLowerCase());
                }
                if (commit.commit?.committer?.email && !isExcludedEmail(commit.commit.committer.email)) {
                  emails.add(commit.commit.committer.email.toLowerCase());
                }
              });
              
            } catch (err) {
              console.error(`Error fetching commits for ${repo.full_name}:`, err.message);
            }
          })
        );
        
        await Promise.all(repoTasks);
        console.log(`→ GitHub repos: ${emails.size} total emails`);
        
      } catch (error) {
        console.error("GitHub repo search error:", error.message);
      }
    })
  ];
  
  await Promise.all(githubTasks);
  
  const validEmails = Array.from(emails).filter(email => validator.isEmail(email));
  console.log(`→ GitHub total: ${validEmails.length} valid emails`);
  return validEmails;
}

/**
 * Enhanced Reddit search with multiple subreddits
 */
async function scrapeRedditEmailsConcurrent(query) {
  console.log("Starting concurrent Reddit search...");
  const emails = new Set();
  
  const subreddits = ['all', 'programming', 'webdev', 'startups', 'entrepreneur', 'jobs', 'freelance'];
  
  const redditTasks = subreddits.map(subreddit =>
    apiLimit(async () => {
      try {
        const searchUrl = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&limit=50&sort=relevance`;
        const response = await fetchWithRetry(searchUrl, 2, 800);
        const posts = response.data?.data?.children || [];
        
        posts.forEach(post => {
          const postData = post.data;
          const textContent = `${postData.title || ''} ${postData.selftext || ''} ${postData.author || ''}`;
          const foundEmails = extractEmails(textContent);
          foundEmails.forEach(email => emails.add(email));
        });
        
        console.log(`→ Reddit r/${subreddit}: ${posts.length} posts processed`);
        
      } catch (error) {
        console.error(`Reddit r/${subreddit} error:`, error.message);
      }
    })
  );
  
  await Promise.all(redditTasks);
  
  const validEmails = Array.from(emails).filter(email => validator.isEmail(email));
  console.log(`→ Reddit total: ${validEmails.length} valid emails`);
  return validEmails;
}

/**
 * Concurrent URL processing
 */
async function processUrlsConcurrent(urls) {
  console.log(`Processing ${urls.length} URLs concurrently...`);
  const emails = new Set();
  const puppeteerUrls = [];
  
  const urlTasks = urls.slice(0, 50).map(url => // Process max 50 URLs
    urlLimit(async () => {
      try {
        // Check if URL needs Puppeteer
        if (url.includes("instagram.com") || 
            url.includes("facebook.com") || 
            url.includes("twitter.com") ||
            url.includes("linkedin.com")) {
          puppeteerUrls.push(url);
          return;
        }
        
        const response = await fetchWithRetry(url, 1, 500);
        const html = response.data;
        const foundEmails = extractEmails(html);
        
        console.log(`→ ${url}: ${foundEmails.length} emails`);
        foundEmails.forEach(email => emails.add(email));
        
      } catch (err) {
        console.error(`→ Error processing ${url}: ${err.message}`);
        // Add failed URLs to Puppeteer queue
        if (puppeteerUrls.length < 20) {
          puppeteerUrls.push(url);
        }
      }
    })
  );
  
  await Promise.all(urlTasks);
  
  // Process social media URLs with Puppeteer
  if (puppeteerUrls.length > 0) {
    const puppeteerEmails = await scrapeEmailsWithPuppeteerFast(puppeteerUrls);
    puppeteerEmails.forEach(email => emails.add(email));
  }
  
  const validEmails = Array.from(emails).filter(email => validator.isEmail(email));
  console.log(`→ URL processing: ${validEmails.length} valid emails`);
  return validEmails;
}

/**
 * Faster Puppeteer with optimizations
 */
async function scrapeEmailsWithPuppeteerFast(urls) {
  const emails = new Set();
  let browser;
  
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-images",
        "--disable-javascript",
        "--disable-plugins",
        "--disable-extensions",
        "--no-first-run"
      ]
    });
    
    const pages = await Promise.all(Array(3).fill().map(() => browser.newPage()));
    
    // Configure all pages
    for (const page of pages) {
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      await page.setViewport({ width: 1024, height: 768 });
      
      await page.setRequestInterception(true);
      page.on('request', req => {
        if (['stylesheet', 'image', 'font', 'media'].includes(req.resourceType())) {
          req.abort();
        } else {
          req.continue();
        }
      });
    }
    
    // Process URLs in batches across multiple pages
    const batchSize = 3;
    for (let i = 0; i < Math.min(urls.length, 15); i += batchSize) {
      const batch = urls.slice(i, i + batchSize);
      
      const batchTasks = batch.map((url, index) => {
        const page = pages[index % pages.length];
        return (async () => {
          try {
            console.log(`Puppeteer batch processing: ${url}`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
            await delay(1000);
            
            const content = await page.content();
            const foundEmails = extractEmails(content);
            
            console.log(`→ Puppeteer ${url}: ${foundEmails.length} emails`);
            foundEmails.forEach(email => emails.add(email));
            
          } catch (err) {
            console.error(`→ Puppeteer error ${url}: ${err.message}`);
          }
        })();
      });
      
      await Promise.all(batchTasks);
    }
    
  } catch (error) {
    console.error("Puppeteer error:", error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
  
  return Array.from(emails);
}

/**
 * Main optimized scraping function
 */
async function scrapeEmails(query, sites, pagesToScrape = 3) {
  console.log("Starting optimized concurrent email scraping...");
  const startTime = Date.now();
  const allEmails = new Set();
  
  // Run all scraping methods concurrently
  const scrapingTasks = [
    // Search engines
    (async () => {
      const searchResults = await searchAllEngines(query, sites, pagesToScrape);
      searchResults.emails.forEach(email => allEmails.add(email));
      
      // Process found URLs
      if (searchResults.urls.length > 0) {
        const urlEmails = await processUrlsConcurrent(searchResults.urls);
        urlEmails.forEach(email => allEmails.add(email));
      }
    })(),
    
    // GitHub API
    (async () => {
      if (sites.includes('github.com') || sites.length === 0) {
        const githubEmails = await scrapeGitHubEmailsConcurrent(query);
        githubEmails.forEach(email => allEmails.add(email));
      }
    })(),
    
    // Reddit API
    (async () => {
      if (sites.includes('reddit.com') || sites.length === 0) {
        const redditEmails = await scrapeRedditEmailsConcurrent(query);
        redditEmails.forEach(email => allEmails.add(email));
      }
    })()
  ];
  
  // Wait for all scraping tasks to complete
  await Promise.all(scrapingTasks);
  
  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000;
  
  const finalEmails = Array.from(allEmails).filter(email => validator.isEmail(email));
  console.log(`\n=== SCRAPING COMPLETED ===`);
  console.log(`Total time: ${duration.toFixed(2)} seconds`);
  console.log(`Total unique valid emails: ${finalEmails.length}`);
  console.log(`Rate: ${(finalEmails.length / duration).toFixed(2)} emails/second`);
  
  return finalEmails;
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
    if (pages && (typeof pages !== "number" || pages <= 0 || pages > 5)) {
      return res.status(400).json({ error: "Pages must be a positive number between 1 and 5" });
    }
    if (domains && !Array.isArray(domains)) {
      return res.status(400).json({ error: "Domains must be an array" });
    }

    const userIdentifier = req.user?._id || userId || "anonymous";

    // Expanded domain list for better coverage
    const defaultDomains = [
      "@gmail.com", "@yahoo.com", "@hotmail.com", "@outlook.com", "@icloud.com",
      "@aol.com", "@email.com", "@protonmail.com", "@zoho.com", "@gmx.com",
      "@mail.com", "@yandex.com", "@tutanota.com", "@fastmail.com",
      "@live.com", "@msn.com", "@comcast.net", "@verizon.net", "@att.net",
      "@bellsouth.net", "@charter.net", "@cox.net", "@earthlink.net"
    ];
    const customDomains = domains || [];
    const allDomains = [...new Set([...defaultDomains, ...customDomains])];

    // Expanded sites list for better coverage
    const sites = req.body.sites || [
      "github.com", "reddit.com", "stackoverflow.com", "medium.com",
      "dev.to", "hackernews.com", "twitter.com", "linkedin.com",
      "facebook.com", "instagram.com", "youtube.com", "twitch.tv",
      "discord.com", "telegram.org", "whatsapp.com"
    ];

    console.log(`\n=== STARTING EMAIL SCRAPER ===`);
    console.log(`Query: "${query}"`);
    console.log(`Sites: ${sites.join(', ')}`);
    console.log(`Pages per engine: ${pages}`);
    console.log(`Target: 500-1000 emails`);
    
    // Enhanced query with domain targeting
    const domainQueries = allDomains.map(d => `"${d}"`).join(" OR ");
    const fullQuery = `${query} (${domainQueries})`;
    
    // Start scraping
    const emails = await scrapeEmails(fullQuery, sites, pages);

    if (emails.length === 0) {
      return res.status(404).json({ 
        message: "No emails found. Try different keywords, increase pages, or add more sites." 
      });
    }

    console.log(`\n=== FINAL RESULTS ===`);
    console.log(`Valid emails found: ${emails.length}`);
    console.log(`Target achieved: ${emails.length >= 500 ? 'YES' : 'NO'}`);

    // Save campaign
    if (userIdentifier && userIdentifier !== "anonymous") {
      const newCampaign = new Campaign({
        userId: userIdentifier,
        campaignName,
        toolType: "email-scraper",
        query,
        recipients: emails,
        status: "completed",
      });
      await newCampaign.save();
      console.log(`Campaign saved with ${emails.length} emails`);
    }

    // Generate and send CSV
    const csvPath = await generateCSV(emails);
    if (!csvPath) {
      return res.status(500).json({ error: "Failed to generate CSV file" });
    }

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename=emails-${query.replace(/\s+/g, '-')}-${Date.now()}.csv`);

    const fileStream = fs.createReadStream(csvPath);
    fileStream.pipe(res);
    
    fileStream.on("close", () => {
      fs.unlink(csvPath, (err) => {
        if (err) console.error("Failed to delete temp file:", err);
      });
    });
    
    fileStream.on("error", (err) => {
      console.error("File stream error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error streaming file" });
      }
    });

  } catch (error) {
    console.error("Email scraper error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "Scraping failed" });
    }
  }
};

// Routes
router.post("/email-scraper", handleEmailScraper);
router.post("/scrape-emails", handleEmailScraper);

module.exports = router;
module.exports.handleEmailScraper = handleEmailScraper;
