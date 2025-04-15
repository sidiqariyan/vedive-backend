const puppeteer = require('puppeteer-extra');
const cheerio = require('cheerio');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(stealthPlugin());

// Utility function to add delays
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to auto-scroll the page
async function autoScroll(page) {
  console.log("Starting auto-scroll...");
  await page.evaluate(async () => {
    let totalHeight = 0;
    const distance = 1000;
    const maxScrolls = 20; // Limit scrolls to prevent infinite operation
    let scrolls = 0;
    
    while (scrolls < maxScrolls) {
      window.scrollBy(0, distance);
      totalHeight += distance;
      scrolls++;
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Break if reached bottom of page
      if (totalHeight >= document.body.scrollHeight) {
        console.log("Reached bottom of page");
        break;
      }
    }
    return `Scrolled ${scrolls} times`;
  });
  console.log("Auto-scroll completed");
}

// Retry navigation logic
async function navigateWithRetries(page, url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`Navigation attempt ${i + 1} to: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      console.log("Navigation successful");
      return;
    } catch (error) {
      console.warn(`Navigation attempt ${i + 1} failed: ${error.message}`);
      if (i === retries - 1) throw error;
      await delay(2000); // Wait before retrying
    }
  }
}

// Helper function to parse business details with multiple selector strategies
function parseBusinessDetails($, businesses) {
  console.log("Starting business parsing with primary selectors");
  
  // Strategy 1: Primary selector for newer Google Maps layout
  let businessItems = $('div[jsaction*="mouseover:pane"] div[role="article"]');
  console.log(`Found ${businessItems.length} businesses with primary selector`);
  
  if (businessItems.length === 0) {
    console.log("No results found using primary selector; using fallback selector");
    // Fallback strategy: Alternative selector for different layouts
    businessItems = $('a[href*="/maps/place/"]').parent().parent();
    console.log(`Found ${businessItems.length} businesses with fallback selector`);
  }
  
  // If still no results, try another fallback
  if (businessItems.length === 0) {
    console.log("No results found using fallback selector; using second fallback");
    businessItems = $('div[data-result-index]');
    console.log(`Found ${businessItems.length} businesses with second fallback selector`);
  }
  
  // Last attempt - broader selector
  if (businessItems.length === 0) {
    console.log("Using broader selector as last resort");
    businessItems = $('div.fontHeadlineSmall').parent().parent();
    console.log(`Found ${businessItems.length} businesses with broader selector`);
  }
  
  businessItems.each((index, item) => {
    try {
      const element = $(item);
      const urlElement = element.find('a[href*="/maps/place/"]');
      const url = urlElement.attr('href') || "";
      
      // Extract store name with multiple possible selectors
      let storeName = element.find('div.fontHeadlineSmall').text().trim();
      if (!storeName) storeName = element.find('h3').text().trim();
      if (!storeName) storeName = urlElement.text().trim();
      
      // Extract website if available
      const website = element.find('a[data-value="Website"], a[aria-label*="website"]').attr('href') || "N/A";
      
      // Extract rating
      let ratingText = "N/A";
      const ratingElement = element.find('span[aria-label*="stars"], span[aria-label*="rating"]');
      if (ratingElement.length) {
        ratingText = ratingElement.attr('aria-label') || "N/A";
      }
      
      // Extract address and phone information
      const detailsElements = element.find('div.fontBodyMedium, div[jsinstance="*0"], div[role="text"]');
      let category = "N/A";
      let address = "N/A";
      let phone = "N/A";
      
      // Process details text from multiple possible elements
      detailsElements.each((i, el) => {
        const text = $(el).text().trim();
        
        // Try to identify phone numbers with regex
        if (/^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]{6,}$/.test(text.replace(/\s/g, ''))) {
          phone = text;
        }
        // If it contains commas or typical address characters, likely an address
        else if (text.includes(',') || /\d+\s+[A-Za-z]/.test(text)) {
          address = text;
        }
        // First non-matching text is probably the category
        else if (category === "N/A" && text) {
          category = text;
        }
      });
      
      // Extract Place ID from URL
      const placeIdMatch = url.match(/place\/[^\/]+\/([^\/\?]+)/);
      const placeId = placeIdMatch ? placeIdMatch[1] : (url.match(/ChI[\w-]+/) || ["N/A"])[0];
      
      // Log the extracted information
      console.log(`Business #${index + 1}:`, {
        storeName: storeName || "N/A",
        phone: phone || "N/A",
        address: address || "N/A"
      });
      
      if (storeName) {
        businesses.push({
          index: index + 1,
          storeName: storeName || "N/A",
          placeId: placeId || "N/A",
          address: address || "N/A",
          category: category || "N/A",
          phone: phone || "N/A",
          googleUrl: url || "N/A",
          bizWebsite: website || "N/A",
          ratingText: ratingText || "N/A"
        });
      }
    } catch (error) {
      console.warn(`Error parsing business at index ${index}:`, error.message);
    }
  });
  
  return businesses;
}

// Parse phone numbers from the page using various selectors and methods
async function extractPhoneNumbers(page, businesses) {
  console.log("Attempting to extract additional phone numbers...");
  
  // For businesses without phone numbers, try to click and get details
  for (let i = 0; i < Math.min(businesses.length, 5); i++) {
    if (businesses[i].phone === "N/A") {
      try {
        // Try to find and click the business link
        const selector = `a[href*="${businesses[i].placeId}"]`;
        const exists = await page.$(selector) !== null;
        
        if (exists) {
          console.log(`Clicking on business: ${businesses[i].storeName}`);
          await page.click(selector);
          await delay(2000);
          
          // Look for phone numbers in the details panel
          const phoneNumber = await page.evaluate(() => {
            // Try various selectors that might contain phone numbers
            const phoneElements = Array.from(document.querySelectorAll('button[aria-label*="phone"], a[href^="tel:"], span[aria-label*="phone"]'));
            for (const el of phoneElements) {
              const phoneText = el.textContent || el.getAttribute('aria-label') || '';
              if (phoneText.match(/\d{3}[-\s]?\d{3}[-\s]?\d{4}/) || phoneText.match(/\+\d{1,3}\s?\d{5,}/)) {
                return phoneText.trim();
              }
            }
            return null;
          });
          
          if (phoneNumber) {
            console.log(`Found phone number for ${businesses[i].storeName}: ${phoneNumber}`);
            businesses[i].phone = phoneNumber;
          }
          
          // Go back to results
          await page.goBack();
          await delay(1000);
        }
      } catch (error) {
        console.warn(`Error getting details for ${businesses[i].storeName}:`, error.message);
      }
    }
  }
}

// Main scraping function
async function searchGoogleMaps(query) {
  if (!query || typeof query !== "string" || query.trim() === "") {
    throw new Error("Invalid query. Please provide a valid search term.");
  }

  console.log(`Starting Google Maps search for: "${query}"`);
  let browser;
  
  try {
    // Launch browser with appropriate options
    const launchOptions = {
      headless: process.env.HEADLESS !== "false",
      args: [
        "--no-sandbox", 
        "--disable-setuid-sandbox", 
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-web-security"
      ],
      defaultViewport: { width: 1280, height: 800 }
    };
    
    console.log("Launching browser with options:", JSON.stringify(launchOptions));
    browser = await puppeteer.launch(launchOptions);
    
    const page = await browser.newPage();
    
    // Set user agent and other options to avoid detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.81 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    });

    // Navigate to Google Maps with the search query
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    console.log(`Navigating to Google Maps with query: ${query}`);
    await navigateWithRetries(page, searchUrl);
    
    console.log("Waiting for initial page load...");
    await delay(5000);
    
    // Check if we got the "Before you continue to Google Maps" page
    const consentButton = await page.$('button[jsname="higCR"]');
    if (consentButton) {
      console.log("Found consent page, clicking accept button");
      await consentButton.click();
      await delay(3000);
    }
    
    console.log("Scrolling through results...");
    await autoScroll(page);
    
    console.log("Extracting page content...");
    const html = await page.content();
    
    // For debugging - save HTML to analyze structure (uncomment if needed)
    // const fs = require('fs');
    // fs.writeFileSync('google_maps_debug.html', html);
    
    const $ = cheerio.load(html);
    let businesses = [];
    
    console.log("Parsing business data...");
    parseBusinessDetails($, businesses);
    
    // If very few results, try additional method
    if (businesses.length < 3) {
      console.log("Few results found, trying to extract additional information");
      await extractPhoneNumbers(page, businesses);
    }
    
    // Remove duplicates based on placeId
    const uniqueBusinesses = Array.from(
      new Map(businesses.filter(b => b.placeId !== "N/A").map(item => [item.placeId, item])).values()
    );
    
    console.log(`Found ${uniqueBusinesses.length} unique businesses`);
    
    // Sort businesses by rating and then by those with phone numbers
    uniqueBusinesses.sort((a, b) => {
      // Prioritize businesses with phone numbers
      if (a.phone !== "N/A" && b.phone === "N/A") return -1;
      if (a.phone === "N/A" && b.phone !== "N/A") return 1;
      
      // Then sort by rating
      const ratingA = parseFloat(a.ratingText?.replace(/[^0-9.]/g, "")) || 0;
      const ratingB = parseFloat(b.ratingText?.replace(/[^0-9.]/g, "")) || 0;
      return ratingB - ratingA;
    });
    
    console.log(`Scraped ${uniqueBusinesses.length} businesses successfully.`);
    return uniqueBusinesses;
  } catch (error) {
    console.error('Error while scraping Google Maps:', error);
    console.error('Stack trace:', error.stack);
    return [];
  } finally {
    if (browser) {
      console.log("Closing browser...");
      await browser.close();
    }
  }
}

module.exports = { searchGoogleMaps };
