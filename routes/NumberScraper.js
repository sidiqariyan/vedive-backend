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

// Auto-scroll function to load more results
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
        if (scrollCount >= maxScrolls) {
          clearInterval(timer);
          resolve(`Scrolled ${scrollCount} times`);
        }
      }, 1000);
    });
  });
}

// Extract business information using Cheerio from the Google Maps HTML
async function extractBusinessInformation(page, html) {
  logTime("Extracting business information via Cheerio");
  const businesses = [];
  const $ = cheerio.load(html);
  
  // Adjust the selector as needed. Google Maps pages are dynamic,
  // so sometimes selectors change.
  $('div[role="article"]').each((i, elem) => {
    const storeName = $(elem).find('div.fontHeadlineSmall').text().trim();
    if (storeName) {
      businesses.push({
        index: i + 1,
        storeName,
        placeId: 'N/A',
        address: 'N/A',
        category: 'N/A',
        phone: 'N/A',
        googleUrl: 'N/A',
        bizWebsite: 'N/A',
        ratingText: 'N/A'
      });
    }
  });
  return businesses;
}

// Alternative extraction method using Google Search instead of Maps
async function alternativeExtraction(page, query) {
  try {
    logTime("Trying alternative extraction via Google Search");
    // Longer delay to let Google settle down
    await delay(5000);
    
    // Ideally, use a proxy here to avoid HTTP 429:
    // For example, pass proxy settings in launchOptions.
    await page.goto(
      `https://www.google.com/search?q=${encodeURIComponent(query)}+business+phone+number`,
      { waitUntil: 'networkidle2' }
    );
    await delay(5000);
    return await page.evaluate(() => {
      const businesses = [];
      const businessCards = Array.from(
        document.querySelectorAll('div.vwVdIc, div.VkpGBb, div[data-hveid]')
      );
      businessCards.forEach((card, index) => {
        try {
          const nameEl = card.querySelector('h3, div[role="heading"]');
          if (!nameEl) return;
          const name = nameEl.textContent.trim();
          if (!name) return;
          let phone = 'N/A';
          let address = 'N/A';
          const allText = Array.from(
            card.querySelectorAll('div, span')
          )
            .map(el => el.textContent.trim())
            .filter(text => text.length > 0);
          for (const text of allText) {
            if (/^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/.test(text.replace(/\s/g, ''))) {
              phone = text;
              break;
            }
          }
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
              address,
              category: 'N/A',
              phone,
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

// Remove duplicate businesses based on storeName and either placeId or address
function removeDuplicates(businesses) {
  const seen = new Set();
  return businesses.filter(business => {
    const key = business.storeName + '-' + (business.placeId !== 'N/A' ? business.placeId : business.address);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
      headless: 'new', // Use 'new' headless mode or try true if issues occur
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins',
        '--disable-site-isolation-trials',
        '--window-size=1920,1080'
      ],
      // Uncomment and specify executablePath if needed, e.g., '/usr/bin/chromium-browser'
      // Also consider adding proxy parameters here if you have a proxy pool.
      // For example: args: [..., '--proxy-server=your-proxy:port']
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

    // Log browser console messages and response statuses
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
        await delay(3000 + Math.floor(Math.random() * 2000));
      }
    }
    if (!navigationSuccess) {
      throw new Error("Failed to navigate to Google Maps after multiple attempts");
    }

    // Handle consent dialogs by iterating through buttons and checking text
    logTime("Checking for consent dialogs");
    try {
      const buttons = await page.$$('button');
      for (const btn of buttons) {
        const btnText = await page.evaluate(button => button.innerText, btn);
        if (btnText && (btnText.includes("Accept all") || btnText.includes("I agree") || btnText.includes("Accept"))) {
          logTime(`Found consent button with text: "${btnText}"`);
          await btn.click();
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
    let businesses = await extractBusinessInformation(page, html);

    if (businesses.length < 3) {
      logTime("Found few results, trying alternative extraction");
      const altBusinesses = await alternativeExtraction(page, query);
      businesses = businesses.concat(altBusinesses);
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

module.exports = { searchGoogleMaps };
