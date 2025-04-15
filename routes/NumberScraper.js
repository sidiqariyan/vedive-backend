const puppeteer = require('puppeteer-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Initialize puppeteer with stealth plugin
puppeteer.use(stealthPlugin());

// Utility function to add delays with randomness
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to auto-scroll the page to ensure all results load
async function autoScroll(page) {
  console.log('Starting auto-scroll...');
  try {
    await page.evaluate(async () => {
      let totalHeight = 0;
      const distance = 100;
      while (totalHeight < document.body.scrollHeight) {
        window.scrollBy(0, distance);
        totalHeight += distance;
        // Random delay between 300 and 800 ms for a more human-like scroll behavior
        await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 500) + 300));
      }
    });
    console.log('Auto-scroll complete');
  } catch (error) {
    console.error('Error during auto-scroll:', error);
  }
}

// Navigate to the URL with retries
async function navigateWithRetries(page, url, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(`Navigation attempt ${attempt + 1} to ${url}`);
      await page.goto(url, { 
        waitUntil: 'networkidle2',
        timeout: 60000 // 60 seconds timeout
      });
      const pageContent = await page.content();
      if (pageContent.includes('captcha') || pageContent.includes('unusual traffic')) {
        console.warn('Captcha or unusual traffic detected');
        if (attempt === maxRetries - 1) throw new Error('Blocked by Google captcha');
      } else {
        console.log('Navigation successful');
        return;
      }
    } catch (error) {
      console.warn(`Navigation attempt ${attempt + 1} failed: ${error.message}`);
      if (attempt === maxRetries - 1) throw error;
      // Increase backoff time with randomness (e.g., between 1500 and 3000ms multiplied by exponential factor)
      const backoffTime = Math.pow(2, attempt) * (1500 + Math.floor(Math.random() * 1500));
      console.log(`Backing off for ${backoffTime}ms before retrying...`);
      await delay(backoffTime);
    }
  }
}

// Extract search results from the Google search page
async function extractSearchResults(page) {
  console.log('Extracting search results...');
  // Wait for the search results container to load
  await page.waitForSelector('div#search', { timeout: 10000 });
  const results = await page.evaluate(() => {
    const extractedResults = [];
    // Google search results are typically in divs with class "g"
    const items = document.querySelectorAll('div.g');
    items.forEach((item, index) => {
      try {
        const titleElement = item.querySelector('h3');
        const linkElement = item.querySelector('a');
        const snippetElement = item.querySelector('.VwiC3b');
        if (titleElement && linkElement) {
          extractedResults.push({
            index: index + 1,
            title: titleElement.innerText.trim(),
            url: linkElement.href,
            snippet: snippetElement ? snippetElement.innerText.trim() : ""
          });
        }
      } catch (error) {
        console.error(`Error parsing search result at index ${index}:`, error);
      }
    });
    return extractedResults;
  });
  console.log(`Extracted ${results.length} search results`);
  return results;
}

// Main function to search Google using the custom query
async function searchGoogle(query) {
  console.log(`Starting Google search for: "${query}"`);
  if (!query || typeof query !== "string" || query.trim() === "") {
    throw new Error("Invalid query. Please provide a valid search term.");
  }
  
  let browser;
  try {
    console.log('Launching browser...');
    browser = await puppeteer.launch({
      headless: true,
      args: [
        // Optionally, add proxy arguments here if needed: '--proxy-server=YOUR_PROXY'
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--window-size=1920,1080'
      ]
    });
    
    const page = await browser.newPage();
    // Optionally set a rotating or random user agent here
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Block images and fonts for faster load times
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['image', 'font', 'media'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });
    
    // Use the provided query to search Google
    const searchQuery = encodeURIComponent(query);
    const url = `https://www.bing.com/search?pglt=${searchQuery}`;
    await navigateWithRetries(page, url);
    
    // Give time for results to load
    await delay(5000);
    
    // Optionally dismiss pop-ups if present
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      buttons.forEach((button) => {
        if (button.textContent.includes('Accept') || 
            button.textContent.includes('I agree') || 
            button.textContent.includes('OK')) {
          button.click();
        }
      });
    });
    await delay(1000);
    
    // Scroll the page to load more results (if applicable)
    await autoScroll(page);
    
    // Extract the search results
    const results = await extractSearchResults(page);
    return results;
  } catch (error) {
    console.error('Error while scraping Google:', error);
    throw error;
  } finally {
    if (browser) {
      console.log('Closing browser...');
      await browser.close();
    }
  }
}

// Save results to CSV file
async function saveToCSV(results, publicDir) {
  if (!Array.isArray(results) || results.length === 0) {
    console.error("No search results data to save.");
    return null;
  }
  
  const csvFileName = `search_results_${uuidv4()}.csv`;
  const csvFilePath = path.join(publicDir, csvFileName);
  
  const csvWriter = createCsvWriter({
    path: csvFilePath,
    header: [
      { id: "index", title: "Index" },
      { id: "title", title: "Title" },
      { id: "url", title: "URL" },
      { id: "snippet", title: "Snippet" }
    ],
  });
  
  try {
    await csvWriter.writeRecords(results);
    console.log(`CSV file saved successfully: ${csvFilePath}`);
    return csvFileName;
  } catch (error) {
    console.error("Error writing CSV file:", error);
    return null;
  }
}

// Express route handler example
async function handleSearchScraper(req, res) {
  const { query, campaignName } = req.body;
  const userId = req.user?._id;
  
  console.log(`Processing search scraper request for user ${userId}`);
  console.log(`Query: "${query}", Campaign: "${campaignName}"`);
  
  if (!query || !campaignName) {
    return res.status(400).json({ error: "Query and Campaign Name are required" });
  }
  
  if (!userId) {
    return res.status(401).json({ error: "User must be authenticated" });
  }
  
  try {
    // Sanitize inputs
    const sanitizeInput = (input) => {
      if (typeof input !== "string") return "";
      return input.replace(/[^\w\s]/gi, " ").trim().slice(0, 100);
    };
    
    const sanitizedQuery = sanitizeInput(query);
    const sanitizedCampaignName = sanitizeInput(campaignName);
    
    if (!sanitizedQuery || !sanitizedCampaignName) {
      return res.status(400).json({ error: "Invalid query or campaign name after sanitization" });
    }
    
    // Scrape Google for search results
    const results = await searchGoogle(sanitizedQuery);
    if (!results || results.length === 0) {
      return res.status(404).json({ message: "No search results found" });
    }
    
    // Save CSV file to public directory
    const publicDir = path.join(__dirname, "public");
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }
    
    const csvFileName = await saveToCSV(results, publicDir);
    if (!csvFileName) {
      return res.status(500).json({ error: "Failed to save CSV file" });
    }
    
    // Create a downloadable URL for the CSV
    const csvDownloadUrl = `/api/download?filename=${encodeURIComponent(csvFileName)}`;
    
    // (Optional) Save campaign details to your database if needed.
    // For example:
    // const Campaign = require('../models/Campaign');
    // const newCampaign = new Campaign({
    //   userId,
    //   campaignName: sanitizedCampaignName,
    //   toolType: "search-scraper",
    //   query: sanitizedQuery,
    //   results: results,
    //   status: "completed",
    // });
    // await newCampaign.save();
    
    // Return success response
    return res.status(200).json({
      message: "Search scraping completed successfully",
      // campaignId: newCampaign._id,
      results,
      resultCount: results.length,
      csvFileName,
      csvDownloadUrl,
    });
  } catch (error) {
    console.error("Search scraper error:", error);
    return res.status(500).json({ 
      error: "An error occurred while scraping search results",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

module.exports = { 
  searchGoogle,
  saveToCSV,
  handleSearchScraper 
};
