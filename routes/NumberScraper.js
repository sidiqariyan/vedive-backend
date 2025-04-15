const puppeteer = require('puppeteer-extra');
const cheerio = require('cheerio');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(stealthPlugin());

// Utility function to add delays
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to auto-scroll the page to load dynamic results
async function autoScroll(page) {
  await page.evaluate(async () => {
    let totalHeight = 0;
    const distance = 1000;
    const maxScrolls = 50; // Prevent infinite scrolling
    let scrolls = 0;
    while (scrolls < maxScrolls) {
      window.scrollBy(0, distance);
      totalHeight += distance;
      scrolls++;
      await new Promise(resolve => setTimeout(resolve, 3000));
      if (totalHeight >= document.body.scrollHeight) break;
    }
  }, { timeout: 60000 });
}

// Retry navigation logic in case of intermittent failures
async function navigateWithRetries(page, url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      return;
    } catch (error) {
      console.warn(`Navigation attempt ${i + 1} failed. Retrying...`);
      if (i === retries - 1) throw error;
    }
  }
}

// Helper function to parse business details from a container element
function parseBusinessDetails(container, index) {
  try {
    // Update selectors based on the current Google Maps layout.
    // These selectors may need to be adjusted based on your inspection of the page.
    const url = container.find('a[href*="/maps/place/"]').attr('href') || "N/A";
    const website = container.find('a[data-value="Website"]').attr('href') || "N/A";
    const storeName = container.find('.fontHeadlineSmall').text().trim() || "N/A";
    const ratingText = container.find('span[aria-label]').attr('aria-label') || "N/A";
    // This is an example—if the details are separated by "·", split them.
    const detailsRaw = container.find('.fontBodyMedium').first().text();
    const detailsText = detailsRaw ? detailsRaw.split('·').map(t => t.trim()) : [];
    const category = detailsText[0] || "N/A";
    const address = detailsText[1] || "N/A";
    const phone = detailsText[2] || "N/A";
    const placeIdMatch = url && url.match(/ChI[\w-]+/);
    const placeId = placeIdMatch ? placeIdMatch[0] : "N/A";

    console.log(`Parsed business #${index + 1}:`, { storeName, placeId, address, category, phone });

    return {
      index: index + 1,
      storeName,
      placeId,
      address,
      category,
      phone,
      googleUrl: url,
      bizWebsite: website,
      ratingText,
    };
  } catch (error) {
    console.warn(`Error parsing business at index ${index}:`, error.message);
    return null;
  }
}

// Main scraping function for Google Maps
async function searchGoogleMaps(query) {
  if (!query || typeof query !== "string" || query.trim() === "") {
    throw new Error("Invalid query. Please provide a valid search term.");
  }

  console.log(`Received query: "${query}"`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: process.env.HEADLESS !== "false",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    });

    const page = await browser.newPage();
    // Set a common user agent string
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/91.0.4472.124 Safari/537.36'
    );

    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    console.log(`Navigating to Google Maps with query: ${query}`);
    await navigateWithRetries(page, searchUrl);

    // Increase the waiting time to ensure dynamic content loads
    console.log("Waiting for initial page load...");
    await delay(8000);

    console.log("Scrolling through results...");
    await autoScroll(page);

    console.log("Extracting page content...");
    const html = await page.content();

    const $ = cheerio.load(html);
    const businesses = [];

    console.log("Parsing business data...");
    // Primary selector (update this selector if Google Maps markup has changed)
    $("div.section-result").each((i, el) => {
      const container = $(el);
      const business = parseBusinessDetails(container, i);
      if (business) businesses.push(business);
    });

    // Fallback: try an alternate selector if no results were found
    if (businesses.length === 0) {
      console.warn("No results found using primary selector; using fallback selector.");
      $("div.section-result-content").each((i, el) => {
        const container = $(el);
        const business = parseBusinessDetails(container, i);
        if (business) businesses.push(business);
      });
    }

    // Remove duplicates based on placeId
    const uniqueBusinesses = Array.from(
      new Map(businesses.map(item => [item.placeId, item])).values()
    );

    console.log(`Found ${uniqueBusinesses.length} unique businesses`);
    console.log(`Scraped ${uniqueBusinesses.length} businesses successfully.`);
    return uniqueBusinesses;
  } catch (error) {
    console.error("Error while scraping Google Maps:", error.message);
    return [];
  } finally {
    if (browser) {
      console.log("Closing browser...");
      await browser.close();
    }
  }
}

module.exports = { searchGoogleMaps };
