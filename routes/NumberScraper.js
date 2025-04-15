const puppeteer = require('puppeteer-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Initialize puppeteer with stealth plugin to avoid detection
puppeteer.use(stealthPlugin());

// Utility function to add delays
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to auto-scroll the page to load more results
async function autoScroll(page) {
  console.log('Starting auto-scroll...');
  await page.evaluate(async () => {
    let totalHeight = 0;
    const distance = 800;
    const maxScrolls = 30; // Prevent infinite scrolling
    let scrolls = 0;
    
    while (scrolls < maxScrolls) {
      window.scrollBy(0, distance);
      totalHeight += distance;
      scrolls++;
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Check if we've reached the bottom
      if (totalHeight >= document.body.scrollHeight) {
        break;
      }
    }
  });
  console.log('Auto-scroll complete');
}

// Retry navigation logic with backoff
async function navigateWithRetries(page, url, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(`Navigation attempt ${attempt + 1} to ${url}`);
      await page.goto(url, { 
        waitUntil: 'networkidle2',
        timeout: 60000 // 60 second timeout
      });
      console.log('Navigation successful');
      return;
    } catch (error) {
      console.warn(`Navigation attempt ${attempt + 1} failed: ${error.message}`);
      
      // If this is the last attempt, throw the error
      if (attempt === maxRetries - 1) throw error;
      
      // Exponential backoff
      const backoffTime = Math.pow(2, attempt) * 1000;
      console.log(`Backing off for ${backoffTime}ms before retrying...`);
      await delay(backoffTime);
    }
  }
}

// Extract business details from page
async function extractBusinessDetails(page) {
  console.log('Extracting business details...');
  
  return await page.evaluate(() => {
    const businesses = [];
    
    // Find all business listings
    const businessCards = Array.from(document.querySelectorAll('div[jsaction] a[href*="/maps/place/"]'))
      .map(a => a.closest('div[jsaction]'))
      .filter(Boolean);
    
    businessCards.forEach((card, index) => {
      try {
        // Basic business information
        const nameElement = card.querySelector('.fontHeadlineSmall');
        const ratingElement = card.querySelector('span[aria-label*="stars"]');
        const detailsElement = card.querySelector('div.fontBodyMedium');
        
        // URLs
        const googleUrlElement = card.querySelector('a[href*="/maps/place/"]');
        const websiteElement = card.querySelector('a[data-value="Website"]');
        
        // Get text content with fallbacks
        const storeName = nameElement ? nameElement.textContent.trim() : "N/A";
        const ratingText = ratingElement ? ratingElement.getAttribute('aria-label') : "Not rated";
        const googleUrl = googleUrlElement ? googleUrlElement.href : "N/A";
        const bizWebsite = websiteElement ? websiteElement.href : "N/A";
        
        // Parse details text which often contains category, address, and phone
        let category = "N/A";
        let address = "N/A";
        let phone = "N/A";
        
        if (detailsElement) {
          const detailsText = detailsElement.textContent;
          const parts = detailsText.split('·').map(part => part.trim());
          
          if (parts.length >= 1) category = parts[0];
          if (parts.length >= 2) address = parts[1];
          if (parts.length >= 3) {
            // Phone numbers often have formats like (123) 456-7890
            const phoneRegex = /(?:\+\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
            const phoneMatch = parts[2].match(phoneRegex);
            phone = phoneMatch ? phoneMatch[0] : parts[2];
          }
        }
        
        // Extract Place ID from URL
        let placeId = "N/A";
        if (googleUrl && googleUrl.includes('ChI')) {
          const placeIdMatch = googleUrl.match(/ChI[^/]+/);
          if (placeIdMatch) placeId = placeIdMatch[0];
        }
        
        businesses.push({
          index: index + 1,
          storeName,
          placeId,
          address,
          category,
          phone,
          googleUrl,
          bizWebsite,
          ratingText
        });
      } catch (error) {
        console.error(`Error parsing business card at index ${index}:`, error);
      }
    });
    
    return businesses;
  });
}

// Main scraping function
async function searchGoogleMaps(query) {
  console.log(`Starting Google Maps search for: "${query}"`);
  
  if (!query || typeof query !== "string" || query.trim() === "") {
    throw new Error("Invalid query. Please provide a valid search term.");
  }
  
  let browser;
  try {
    console.log('Launching browser...');
    browser = await puppeteer.launch({
      headless: true, // Change to false for debugging
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-features=IsolateOrigins,site-per-process',
      ]
    });

    const page = await browser.newPage();
    
    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36');
    
    // Set viewport to a common desktop resolution
    await page.setViewport({ width: 1280, height: 800 });
    
    // Format search query for URL
    const searchQuery = encodeURIComponent(query);
    const url = `https://www.google.com/maps/search/${searchQuery}`;
    
    // Navigate to search results
    await navigateWithRetries(page, url);
    
    // Wait for initial results to load
    console.log('Waiting for results to load...');
    await delay(5000);
    
    // Scroll to load more results
    await autoScroll(page);
    
    // Extract business details
    const businesses = await extractBusinessDetails(page);
    
    console.log(`Found ${businesses.length} businesses`);
    
    // Remove duplicates based on placeId
    const uniqueBusinesses = Array.from(
      new Map(businesses.filter(b => b.placeId !== "N/A").map(item => [item.placeId, item])).values()
    );
    
    console.log(`After deduplication: ${uniqueBusinesses.length} unique businesses`);
    
    // Sort businesses by rating (highest first)
    uniqueBusinesses.sort((a, b) => {
      const ratingA = parseFloat(a.ratingText?.match(/([0-9.]+)/)?.[0]) || 0;
      const ratingB = parseFloat(b.ratingText?.match(/([0-9.]+)/)?.[0]) || 0;
      return ratingB - ratingA;
    });
    
    return uniqueBusinesses;
  } catch (error) {
    console.error('Error while scraping Google Maps:', error);
    throw error;
  } finally {
    if (browser) {
      console.log('Closing browser...');
      await browser.close();
    }
  }
}

// Save results to CSV file
async function saveToCSV(businesses, publicDir) {
  if (!Array.isArray(businesses) || businesses.length === 0) {
    console.error("No businesses data to save.");
    return null;
  }
  
  const csvFileName = `businesses_${uuidv4()}.csv`;
  const csvFilePath = path.join(publicDir, csvFileName);
  
  const csvWriter = createCsvWriter({
    path: csvFilePath,
    header: [
      { id: "index", title: "Index" },
      { id: "storeName", title: "Business Name" },
      { id: "category", title: "Category" },
      { id: "address", title: "Address" },
      { id: "phone", title: "Phone Number" },
      { id: "ratingText", title: "Rating" },
      { id: "googleUrl", title: "Google Maps URL" },
      { id: "bizWebsite", title: "Business Website" },
      { id: "placeId", title: "Place ID" }
    ],
  });
  
  try {
    await csvWriter.writeRecords(businesses);
    console.log(`CSV file saved successfully: ${csvFilePath}`);
    return csvFileName;
  } catch (error) {
    console.error("Error writing CSV file:", error);
    return null;
  }
}

// Express route handler
async function handleNumberScraper(req, res) {
  const { query, campaignName } = req.body;
  const userId = req.user?._id;
  
  console.log(`Processing number scraper request for user ${userId}`);
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
    
    // Scrape Google Maps for business data
    const businesses = await searchGoogleMaps(sanitizedQuery);
    
    if (!businesses || businesses.length === 0) {
      return res.status(404).json({ message: "No businesses found" });
    }
    
    // Extract phone numbers
    const phoneNumbers = businesses
      .map(business => business.phone)
      .filter(phone => phone && phone !== "N/A");
    
    if (phoneNumbers.length === 0) {
      return res.status(404).json({ message: "No valid phone numbers found in the scraped data" });
    }
    
    // Save campaign in database
    const publicDir = path.join(__dirname, "public");
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }
    
    // Save data to CSV
    const csvFileName = await saveToCSV(businesses, publicDir);
    if (!csvFileName) {
      return res.status(500).json({ error: "Failed to save CSV file" });
    }
    
    // Create a downloadable URL for the CSV
    const csvDownloadUrl = `/api/download?filename=${encodeURIComponent(csvFileName)}`;
    
    // Save campaign to database (adjust according to your Campaign model)
    const Campaign = require('../models/Campaign'); // Import your Campaign model
    
    const newCampaign = new Campaign({
      userId,
      campaignName: sanitizedCampaignName,
      toolType: "number-scraper",
      query: sanitizedQuery,
      scrapedNumbers: phoneNumbers,
      status: "completed",
    });
    
    await newCampaign.save();
    console.log(`Campaign saved with ID: ${newCampaign._id}`);
    
    // Return success response
    return res.status(200).json({
      message: "Number scraping completed successfully",
      campaignId: newCampaign._id,
      businesses,
      phoneCount: phoneNumbers.length,
      csvFileName,
      csvDownloadUrl,
    });
  } catch (error) {
    console.error("Number scraper error:", error);
    return res.status(500).json({ 
      error: "An error occurred while scraping business data",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

module.exports = { 
  searchGoogleMaps,
  saveToCSV,
  handleNumberScraper 
};
