const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

// Use stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

// Helper for delays
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Track and log execution time
const startTime = process.hrtime();
function logTime(message) {
  const diff = process.hrtime(startTime);
  const time = (diff[0] * 1e9 + diff[1]) / 1e9;
  console.log(`[${time.toFixed(2)}s] ${message}`);
}

// Main scraping function
async function searchGoogleMaps(query) {
  logTime(`Starting search for: "${query}"`);

  if (!query || typeof query !== "string" || query.trim() === "") {
    throw new Error("Invalid query. Please provide a valid search term.");
  }

  let browser;
  try {
    const launchOptions = {
      headless: 'new', // or use `true` if 'new' causes issues
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins',
        '--disable-site-isolation-trials',
        '--window-size=1920,1080'
      ],
      // Uncomment to use a specific chromium binary, e.g., '/usr/bin/chromium-browser'
      // executablePath: '/path/to/chromium-browser',
      ignoreHTTPSErrors: true,
      defaultViewport: null
    };

    logTime("Launching browser");
    browser = await puppeteer.launch(launchOptions);
    console.log("Browser methods available:", Object.keys(browser));

    let page;
    if (typeof browser.createIncognitoBrowserContext === "function") {
      logTime("Creating incognito browser context");
      const context = await browser.createIncognitoBrowserContext();
      page = await context.newPage();
    } else {
      console.warn("Incognito mode not supported. Using default page context.");
      page = await browser.newPage();
    }

    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36");
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
    });

    page.on("console", (msg) => console.log(`Browser console: ${msg.text()}`));
    page.on("response", (response) => {
      const status = response.status();
      if (status >= 300) {
        console.log(`Response ${status} for URL: ${response.url()}`);
      }
    });

    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    logTime(`Navigating to ${searchUrl}`);

    let navigationSuccess = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto(searchUrl, {
          waitUntil: "networkidle2",
          timeout: 60000
        });
        navigationSuccess = true;
        logTime(`Navigation successful on attempt ${attempt}`);
        break;
      } catch (error) {
        logTime(`Navigation attempt ${attempt} failed: ${error.message}`);
        if (attempt === 3) throw error;
        await delay(3000);
      }
    }
    if (!navigationSuccess) {
      throw new Error("Failed to navigate to Google Maps after multiple attempts");
    }

    logTime("Checking for consent dialogs");
    try {
      const consentSelectors = [
        'button[jsname="higCR"]',
        'button[aria-label="Accept all"]',
        'button:contains("I agree")',
        'button:contains("Accept")'
      ];

      for (const selector of consentSelectors) {
        const consentExists = (await page.$(selector)) !== null;
        if (consentExists) {
          logTime(`Found consent button with selector: ${selector}`);
          await page.click(selector);
          await delay(2000);
          break;
        }
      }
    } catch (error) {
      logTime(`Error handling consent: ${error.message}`);
    }

    logTime("Waiting for search results to load");
    try {
      await Promise.race([
        page.waitForSelector('div[role="article"]', { timeout: 10000 }),
        page.waitForSelector('a[href*="/maps/place/"]', { timeout: 10000 }),
        page.waitForSelector('div.fontHeadlineSmall', { timeout: 10000 })
      ]);
      logTime("Results loaded successfully");
    } catch (error) {
      logTime(`Timeout waiting for results: ${error.message}`);
    }

    logTime("Scrolling to load more results");
    await autoScroll(page);

    const html = await page.content();

    logTime("Extracting business details");
    const businesses = await extractBusinessInformation(page, html);

    if (businesses.length < 3) {
      logTime("Found few results, trying alternative extraction");
      const altBusinesses = await alternativeExtraction(page, query);
      businesses.push(...altBusinesses);
    }

    const uniqueBusinesses = removeDuplicates(businesses);
    logTime(`Found ${uniqueBusinesses.length} unique businesses`);
    return uniqueBusinesses;
  } catch (error) {
    logTime(`ERROR: ${error.message}`);
    console.error(error);
    return [];
  } finally {
    if (browser) {
      logTime("Closing browser");
      await browser.close();
    }
  }
}
// Function to auto-scroll the page
async function autoScroll(page) {
  return await page.evaluate(async () => {
    return await new Promise(resolve => {
      let totalHeight = 0;
      const distance = 800;
      const maxScrolls = 15;
      let scrollCount = 0;
      
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        scrollCount++;
        
        // Stop conditions
        if (scrollCount >= maxScrolls) {
          clearInterval(timer);
          resolve(`Scrolled ${scrollCount} times`);
        }
      }, 1000);
    });
  });
}

// Extract business information using multiple methods
async function extractBusinessInformation(page, html) {
  const businesses = [];
  const $ = cheerio.load(html);
  
  // Try multiple selector patterns
  logTime("Using method 1: Direct article selector");
  extractWithSelector($, 'div[role="article"]', businesses);
  
  logTime("Using method 2: Place link selector");
  extractWithSelector($, 'a[href*="/maps/place/"]', businesses);
  
  logTime("Using method 3: Headline selector");
  extractWithSelector($, 'div.fontHeadlineSmall', businesses);
  
  // If we still don't have results, try JavaScript evaluation in the page
  if (businesses.length === 0) {
    logTime("Using method 4: In-page JavaScript evaluation");
    const jsResults = await page.evaluate(() => {
      const results = [];
      
      // Try to find all possible business containers
      const containers = Array.from(document.querySelectorAll('div[jsaction*="mouseover"], div[jsaction*="click"], a[href*="/maps/place/"]'));
      
      containers.forEach((container, index) => {
        try {
          // Try to extract business name
          const nameElement = container.querySelector('div.fontHeadlineSmall, h3, div[role="heading"]');
          if (!nameElement) return;
          
          const name = nameElement.textContent.trim();
          if (!name) return;
          
          // Extract URL if available
          let url = '';
          const link = container.tagName === 'A' ? container : container.querySelector('a[href*="/maps/place/"]');
          if (link) url = link.href;
          
          // Try to extract phone number
          let phone = 'N/A';
          const allTextElements = Array.from(container.querySelectorAll('div, span'));
          for (const el of allTextElements) {
            const text = el.textContent.trim();
            if (/^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/.test(text.replace(/\s/g, ''))) {
              phone = text;
              break;
            }
          }
          
          // Extract address (any text with commas)
          let address = 'N/A';
          for (const el of allTextElements) {
            const text = el.textContent.trim();
            if (text.includes(',') && text.length > 10) {
              address = text;
              break;
            }
          }
          
          results.push({
            index: index + 1,
            storeName: name,
            placeId: url.match(/place\/[^\/]+\/([^\/\?]+)/) ? url.match(/place\/[^\/]+\/([^\/\?]+)/)[1] : 'N/A',
            address: address,
            category: 'N/A', // Hard to determine reliably
            phone: phone,
            googleUrl: url,
            bizWebsite: 'N/A',
            ratingText: 'N/A'
          });
        } catch (e) {
          console.error(`Error parsing item ${index}:`, e.message);
        }
      });
      
      return results;
    });
    
    businesses.push(...jsResults);
  }
  
  return businesses;
}

// Helper to extract with a specific selector
function extractWithSelector($, selector, businesses) {
  const elements = $(selector);
  console.log(`Found ${elements.length} elements with selector: ${selector}`);
  
  elements.each((i, el) => {
    try {
      const element = $(el);
      
      // Find business name
      let name = element.find('div.fontHeadlineSmall').text().trim();
      if (!name) name = element.find('h3').text().trim();
      if (!name && selector === 'div.fontHeadlineSmall') name = element.text().trim();
      
      if (!name) return;
      
      // Find URL
      let url = '';
      if (selector === 'a[href*="/maps/place/"]') {
        url = element.attr('href') || '';
      } else {
        url = element.find('a[href*="/maps/place/"]').attr('href') || '';
      }
      
      // Extract place ID from URL
      let placeId = 'N/A';
      const placeIdMatch = url.match(/place\/[^\/]+\/([^\/\?]+)/);
      if (placeIdMatch) placeId = placeIdMatch[1];
      if (!placeId || placeId === 'N/A') {
        const altMatch = url.match(/ChI[\w-]+/);
        if (altMatch) placeId = altMatch[0];
      }
      
      // Find all text elements
      const allTextElements = element.find('div, span').map((i, el) => $(el).text().trim()).get();
      
      // Find phone number
      let phone = 'N/A';
      for (const text of allTextElements) {
        if (/^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/.test(text.replace(/\s/g, ''))) {
          phone = text;
          break;
        }
      }
      
      // Find address (text with commas)
      let address = 'N/A';
      for (const text of allTextElements) {
        if (text.includes(',') && text.length > 10 && !text.includes(name)) {
          address = text;
          break;
        }
      }
      
      // Add to businesses array
      businesses.push({
        index: businesses.length + 1,
        storeName: name,
        placeId: placeId,
        address: address,
        category: 'N/A', // Hard to determine reliably
        phone: phone,
        googleUrl: url ? `https://www.google.com${url}` : 'N/A',
        bizWebsite: 'N/A',
        ratingText: 'N/A'
      });
    } catch (error) {
      console.log(`Error processing element ${i}:`, error.message);
    }
  });
}

// Alternative extraction method using Google search instead of maps
async function alternativeExtraction(page, query) {
  try {
    logTime("Trying alternative extraction via Google Search");
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}+business+phone+number`, {
      waitUntil: 'networkidle2'
    });
    
    // Wait for results
    await delay(3000);
    
    // Look for business results
    return await page.evaluate(() => {
      const businesses = [];
      
      // Try to find business cards/local business results
      const businessCards = Array.from(document.querySelectorAll('div.vwVdIc, div.VkpGBb, div[data-hveid]'));
      
      businessCards.forEach((card, index) => {
        try {
          // Extract name
          const nameEl = card.querySelector('h3, div[role="heading"]');
          if (!nameEl) return;
          
          const name = nameEl.textContent.trim();
          if (!name) return;
          
          // Extract phone and address
          let phone = 'N/A';
          let address = 'N/A';
          
          const allText = Array.from(card.querySelectorAll('div, span'))
            .map(el => el.textContent.trim())
            .filter(text => text.length > 0);
          
          // Find phone number
          for (const text of allText) {
            if (/^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/.test(text.replace(/\s/g, ''))) {
              phone = text;
              break;
            }
          }
          
          // Find address
          for (const text of allText) {
            if (text.includes(',') && text.length > 10 && !text.includes(name)) {
              address = text;
              break;
            }
          }
          
          if (name && (phone !== 'N/A' || address !== 'N/A')) {
            businesses.push({
              index: index + 1,
              storeName: name,
              placeId: 'N/A',
              address: address,
              category: 'N/A',
              phone: phone,
              googleUrl: 'N/A',
              bizWebsite: 'N/A',
              ratingText: 'N/A'
            });
          }
        } catch (e) {
          console.error(`Error parsing search result ${index}:`, e.message);
        }
      });
      
      return businesses;
    });
  } catch (error) {
    logTime(`Alternative extraction failed: ${error.message}`);
    return [];
  }
}

// Remove duplicate businesses
function removeDuplicates(businesses) {
  const seen = new Set();
  return businesses.filter(business => {
    // Create a unique key using name and either placeId or address
    const key = business.storeName + '-' + (business.placeId !== 'N/A' ? business.placeId : business.address);
    
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { searchGoogleMaps };
