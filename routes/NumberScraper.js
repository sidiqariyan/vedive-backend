const puppeteer = require('puppeteer-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Initialize puppeteer with stealth plugin
puppeteer.use(stealthPlugin());

// Utility function to add delays
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to auto-scroll the page - improved for Google Maps specific structure
async function autoScroll(page) {
  console.log('Starting auto-scroll...');
  
  try {
    // Wait for the results container to be available
    await page.waitForSelector('div[role="feed"]', { timeout: 10000 })
      .catch(() => console.log('Feed container not found, trying alternative scroll method'));
    
    // This handles both Feed view and regular scroll
    await page.evaluate(async () => {
      const scrollContainer = document.querySelector('div[role="feed"]') || document.documentElement;
      
      const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      let previousHeight;
      let sameHeightCount = 0;
      
      for (let i = 0; i < 20; i++) { // Limit scrolls to avoid infinite loop
        previousHeight = scrollContainer.scrollHeight;
        scrollContainer.scrollBy(0, previousHeight);
        await wait(1000); // Wait for content to load
        
        // Check if we're still scrolling effectively
        if (scrollContainer.scrollHeight === previousHeight) {
          sameHeightCount++;
          if (sameHeightCount >= 3) {
            console.log('Scroll height unchanged for 3 iterations, stopping scroll');
            break; // Stop if height hasn't changed for several iterations
          }
        } else {
          sameHeightCount = 0;
        }
      }
    });
    
    // Additional wait after scrolling to ensure all content loads
    await delay(2000);
    console.log('Auto-scroll complete');
  } catch (error) {
    console.error('Error during auto-scroll:', error);
  }
}

// Navigate to Google Maps with retries
async function navigateWithRetries(page, url, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(`Navigation attempt ${attempt + 1} to ${url}`);
      
      // Clear cookies and cache before each attempt for a fresh session
      if (attempt > 0) {
        await page.session.clearCache();
        const client = await page.target().createCDPSession();
        await client.send('Network.clearBrowserCookies');
      }
      
      await page.goto(url, { 
        waitUntil: 'networkidle2',
        timeout: 60000 // 60 second timeout
      });
      
      // Check for captcha or blocked access
      const pageContent = await page.content();
      if (pageContent.includes('captcha') || pageContent.includes('unusual traffic')) {
        console.warn('Captcha or unusual traffic detection encountered');
        if (attempt === maxRetries - 1) throw new Error('Blocked by Google captcha');
      } else {
        console.log('Navigation successful');
        return;
      }
    } catch (error) {
      console.warn(`Navigation attempt ${attempt + 1} failed: ${error.message}`);
      
      // If this is the last attempt, throw the error
      if (attempt === maxRetries - 1) throw error;
      
      // Exponential backoff
      const backoffTime = Math.pow(2, attempt) * 1000 + Math.floor(Math.random() * 1000);
      console.log(`Backing off for ${backoffTime}ms before retrying...`);
      await delay(backoffTime);
    }
  }
}

// Parse business details - completely rewritten for better extraction
async function extractBusinessDetails(page) {
  console.log('Extracting business details...');
  
  // First attempt: Try with direct DOM queries for business listings
  await delay(2000); // Replaced page.waitForTimeout with delay
  
  // Method 1: Use page.evaluate to extract via DOM
  const businessesMethod1 = await page.evaluate(() => {
    console.log('Running extraction method 1');
    const results = [];
    
    // Find all business cards
    const cards = Array.from(document.querySelectorAll('div[role="article"]'));
    console.log(`Found ${cards.length} article elements`);
    
    if (cards.length === 0) {
      // Alternative selector for cards
      const altCards = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
      console.log(`Found ${altCards.length} place links`);
      
      altCards.forEach((link, index) => {
        try {
          // Get parent container that might contain other details
          const container = link.closest('div[jsaction]') || link.parentElement;
          
          if (!container) return;
          
          const nameElement = container.querySelector('div.fontHeadlineSmall') || 
                              container.querySelector('div[jsan*="fontHeadlineSmall"]') ||
                              link;
                              
          const detailsDiv = container.querySelector('div.fontBodyMedium') || 
                            container.querySelector('div[jsan*="fontBodyMedium"]');
                            
          const rating = container.querySelector('span[aria-label*="star"]');
          
          // Extract data
          const name = nameElement ? nameElement.textContent.trim() : "Unknown";
          const url = link.href;
          
          // Try to parse details text which might contain category, address, phone
          let details = detailsDiv ? detailsDiv.textContent.trim() : "";
          let category = "N/A";
          let address = "N/A";
          let phone = "N/A";
          
          if (details) {
            const parts = details.split('·').map(p => p.trim());
            if (parts.length >= 1) category = parts[0];
            if (parts.length >= 2) address = parts[1];
            if (parts.length >= 3) {
              // Look for phone number pattern
              const phoneRegex = /(?:(?:\+|00)[1-9]\d{0,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{1,4}[\s.-]?\d{1,4}[\s.-]?\d{1,9}/;
              const phoneMatch = parts[2].match(phoneRegex);
              phone = phoneMatch ? phoneMatch[0] : parts[2];
            }
          }
          
          // Extract Place ID from URL
          let placeId = "N/A";
          if (url && url.includes('/maps/place/')) {
            const placeIdMatch = url.match(/!1s([^!]+)/);
            placeId = placeIdMatch ? placeIdMatch[1] : 
                     (url.match(/ChI[^?&/]+/) || ["N/A"])[0];
          }
          
          results.push({
            index: index + 1,
            storeName: name,
            placeId,
            address,
            category,
            phone,
            googleUrl: url,
            bizWebsite: "N/A", // We'll need to fetch this separately
            ratingText: rating ? rating.getAttribute('aria-label') : "Not rated"
          });
        } catch (error) {
          console.error(`Error parsing business card at index ${index}:`, error);
        }
      });
    } else {
      // Process the article elements
      cards.forEach((card, index) => {
        try {
          const nameElement = card.querySelector('div[role="heading"]');
          const link = card.querySelector('a[href*="/maps/place/"]');
          const details = card.querySelectorAll('div:not([role])');
          const rating = card.querySelector('span[aria-label*="star"]');
          
          if (!nameElement || !link) return;
          
          const name = nameElement.textContent.trim();
          const url = link.href;
          
          // Look for category and address in detail elements
          let category = "N/A";
          let address = "N/A";
          let phone = "N/A";
          
          details.forEach(detail => {
            const text = detail.textContent.trim();
            
            // Check if this detail contains business category
            if (text.match(/restaurant|shop|store|salon|clinic|hotel/i) && category === "N/A") {
              category = text;
            }
            
            // Look for address patterns
            if ((text.match(/street|avenue|road|blvd|plaza|mall/i) || 
                text.match(/\d+\s+\w+\s+\w+/)) && address === "N/A") {
              address = text;
            }
            
            // Look for phone number patterns
            const phoneRegex = /(?:(?:\+|00)[1-9]\d{0,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{1,4}[\s.-]?\d{1,4}[\s.-]?\d{1,9}/;
            if (text.match(phoneRegex) && phone === "N/A") {
              phone = text.match(phoneRegex)[0];
            }
          });
          
          // Extract Place ID from URL
          let placeId = "N/A";
          if (url && url.includes('/maps/place/')) {
            const placeIdMatch = url.match(/!1s([^!]+)/);
            placeId = placeIdMatch ? placeIdMatch[1] : 
                     (url.match(/ChI[^?&/]+/) || ["N/A"])[0];
          }
          
          results.push({
            index: index + 1,
            storeName: name,
            placeId,
            address,
            category,
            phone,
            googleUrl: url,
            bizWebsite: "N/A",
            ratingText: rating ? rating.getAttribute('aria-label') : "Not rated"
          });
        } catch (error) {
          console.error(`Error parsing business card at index ${index}:`, error);
        }
      });
    }
    
    return results;
  });
  
  console.log(`Method 1 found ${businessesMethod1.length} businesses`);
  
  // If first method returns empty, try method 2 with more basic but reliable approach
  let businesses = businessesMethod1;
  
  if (businesses.length === 0) {
    console.log('Trying extraction method 2 with screenshot analysis...');
    
    // Take screenshot for debugging (optional, remove in production)
    await page.screenshot({ path: 'debug-screenshot.png' });
    
    // Method 2: Use more basic selectors and text analysis
    businesses = await page.evaluate(() => {
      const results = [];
      
      // Find all elements that might contain business data
      const allElements = document.querySelectorAll('*');
      let nameElements = [];
      
      // Find elements that might be business names (heading-like elements with reasonable text length)
      for (const el of allElements) {
        const text = el.textContent.trim();
        if (text.length > 0 && text.length < 100 && 
            (el.tagName === 'DIV' || el.tagName === 'SPAN' || el.tagName === 'H1' || 
             el.tagName === 'H2' || el.tagName === 'H3')) {
          
          // Check if this looks like a business name
          if (el.offsetHeight > 0 && // Must be visible
              !text.includes('Google') && // Exclude Google UI elements
              !text.includes('Maps') &&
              !text.includes('Search') &&
              !text.includes('Menu') &&
              text.split(' ').length >= 2) { // Must have at least 2 words
            
            nameElements.push(el);
          }
        }
      }
      
      // For each potential business name, try to find associated data
      nameElements.forEach((nameElement, index) => {
        try {
          const name = nameElement.textContent.trim();
          
          // Find the closest container that might have all business info
          let container = nameElement;
          for (let i = 0; i < 5; i++) {
            if (container.parentElement) {
              container = container.parentElement;
            } else {
              break;
            }
          }
          
          // Look for address-like text in the container
          let address = "N/A";
          let phone = "N/A";
          let category = "N/A";
          let url = "N/A";
          
          // Find all text nodes in the container
          const textNodes = [];
          const getAllTextNodes = (node) => {
            if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
              textNodes.push(node.textContent.trim());
            } else {
              for (const child of node.childNodes) {
                getAllTextNodes(child);
              }
            }
          };
          
          getAllTextNodes(container);
          
          // Look for address pattern
          for (const text of textNodes) {
            if (text.match(/\d+\s+\w+/)) {
              address = text;
              break;
            }
          }
          
          // Look for phone pattern
          for (const text of textNodes) {
            if (text.match(/\+?\d[\d\s-]{7,}/)) {
              phone = text;
              break;
            }
          }
          
          // Look for links in the container
          const links = container.querySelectorAll('a');
          for (const link of links) {
            if (link.href && link.href.includes('/maps/place/')) {
              url = link.href;
              break;
            }
          }
          
          results.push({
            index: index + 1,
            storeName: name,
            placeId: "N/A",
            address,
            category,
            phone,
            googleUrl: url,
            bizWebsite: "N/A",
            ratingText: "N/A"
          });
        } catch (error) {
          console.error(`Error in method 2 parsing at index ${index}:`, error.message);
        }
      });
      
      return results;
    });
    
    console.log(`Method 2 found ${businesses.length} businesses`);
  }
  
  // If we're still getting no results, try a third method using HTML parsing
  if (businesses.length === 0) {
    console.log('Trying extraction method 3 with HTML content analysis...');
    
    // Get the page HTML and analyze it directly
    const html = await page.content();
    
    // Look for patterns in the HTML that might indicate business data
    // This is a simplified regex approach - you might want to use a proper HTML parser in production
    const businessRegex = /<div[^>]*>([^<]{5,100})<\/div>[^<]*<div[^>]*>(.*?)<\/div>/g;
    let match;
    const foundBusinesses = [];
    let index = 1;
    
    while ((match = businessRegex.exec(html)) !== null) {
      const name = match[1].trim();
      const details = match[2].trim();
      
      if (name.length > 0 && !name.includes('Google') && !name.includes('Search')) {
        foundBusinesses.push({
          index: index++,
          storeName: name,
          placeId: "N/A",
          address: details.includes('·') ? details.split('·')[1]?.trim() || "N/A" : "N/A",
          category: details.includes('·') ? details.split('·')[0]?.trim() || "N/A" : "N/A",
          phone: details.match(/\+?\d[\d\s-]{7,}/) ? details.match(/\+?\d[\d\s-]{7,}/)[0] : "N/A",
          googleUrl: "N/A",
          bizWebsite: "N/A",
          ratingText: "N/A"
        });
      }
    }
    
    console.log(`Method 3 found ${foundBusinesses.length} potential businesses`);
    
    if (foundBusinesses.length > 0) {
      businesses = foundBusinesses;
    }
  }
  
  // Filter out obviously invalid entries
  const validBusinesses = businesses.filter(b => 
    b.storeName && 
    b.storeName !== "N/A" && 
    b.storeName.length > 1 &&
    !b.storeName.includes('Google') &&
    !b.storeName.includes('Maps')
  );
  
  console.log(`Found ${validBusinesses.length} valid businesses after filtering`);
  return validBusinesses;
}

// Main scraping function with improved error handling
async function searchGoogleMaps(query) {
  console.log(`Starting Google Maps search for: "${query}"`);
  
  if (!query || typeof query !== "string" || query.trim() === "") {
    throw new Error("Invalid query. Please provide a valid search term.");
  }
  
  let browser;
  try {
    console.log('Launching browser...');
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--window-size=1920,1080',
        '--disable-features=IsolateOrigins,site-per-process',
      ]
    });

    const page = await browser.newPage();
    
    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36');
    
    // Set viewport to a common desktop resolution
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Block unnecessary resources to speed up loading
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
        req.abort();
      } else {
        req.continue();
      }
    });
    
    // Format search query for URL - trying a more specific query format for Google Maps
    const searchQuery = encodeURIComponent(query);
    const url = `https://www.google.com/maps/search/${searchQuery}`;
    
    // Navigate to search results
    await navigateWithRetries(page, url);
    
    // Wait for initial results to load
    console.log('Waiting for results to load...');
    await delay(5000);
    
    // Try to dismiss any pop-ups or consent dialogs
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      for (const button of buttons) {
        if (button.textContent.includes('Accept') || 
            button.textContent.includes('I agree') || 
            button.textContent.includes('OK')) {
          button.click();
        }
      }
    });
    
    await delay(1000);
    
    // Scroll to load more results
    await autoScroll(page);
    
    // Extract business details
    const businesses = await extractBusinessDetails(page);
    
    if (businesses.length === 0) {
      console.log('No businesses found, trying alternative search method...');
      
      // Try an alternative search format
      const altUrl = `https://www.google.com/search?tbm=map&q=${searchQuery}`;
      await navigateWithRetries(page, altUrl);
      await delay(5000);
      await autoScroll(page);
      
      const altBusinesses = await extractBusinessDetails(page);
      if (altBusinesses.length > 0) {
        console.log(`Alternative search found ${altBusinesses.length} businesses`);
        return altBusinesses;
      }
    }
    
    console.log(`Found ${businesses.length} businesses`);
    
    // Remove duplicates based on business name (since placeId might be missing)
    const uniqueBusinesses = Array.from(
      new Map(businesses.map(item => [item.storeName, item])).values()
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

// Save results to CSV file (unchanged from before)
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
    // Sanitize inputs (unchanged)
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
      return res.status(404).json({ 
        message: "No valid phone numbers found in the scraped data",
        businessCount: businesses.length,
        businesses: businesses.slice(0, 5) // Return sample of businesses for debugging
      });
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
