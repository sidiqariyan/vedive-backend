const puppeteer = require('puppeteer-extra');
const cheerio = require('cheerio');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');
const { createObjectCsvWriter } = require('csv-writer'); // Directly use csv-writer
const { v4: uuidv4 } = require('uuid'); // For unique filenames
const path = require('path');

puppeteer.use(stealthPlugin());

// Utility function to add delays
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to auto-scroll the page
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
      await new Promise(resolve => setTimeout(resolve, 700));
      if (totalHeight >= document.body.scrollHeight) break;
    }
  }, { timeout: 60000 }); // Set a timeout for the scroll operation
}

// Retry navigation logic
async function navigateWithRetries(page, url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await page.goto(url, { waitUntil: 'networkidle2' });
      return;
    } catch (error) {
      console.warn(`Navigation attempt ${i + 1} failed. Retrying...`);
      if (i === retries - 1) throw error;
    }
  }
}

// Save businesses data to a CSV file
async function saveToCSV(businesses) {
  if (!Array.isArray(businesses) || businesses.length === 0) {
    console.error('No businesses data to save.');
    return;
  }

  const csvFileName = path.join(__dirname, `businesses_${uuidv4()}.csv`); // Absolute path
  const csvWriter = createObjectCsvWriter({
    path: csvFileName,
    header: [
      { id: 'index', title: 'Index' },
      { id: 'storeName', title: 'Store Name' },
      { id: 'placeId', title: 'Place ID' },
      { id: 'address', title: 'Address' },
      { id: 'category', title: 'Category' },
      { id: 'phone', title: 'Phone' },
      { id: 'googleUrl', title: 'Google URL' },
      { id: 'bizWebsite', title: 'Business Website' },
      { id: 'ratingText', title: 'Rating' }
    ]
  });

  try {
    console.log(`Attempting to write ${businesses.length} records to CSV...`);
    await csvWriter.writeRecords(businesses);
    console.log(`The CSV file "${csvFileName}" was written successfully.`);
  } catch (error) {
    console.error('Error writing CSV file:', error.message);
  }
}

// Main scraping function
async function searchGoogleMaps(query) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: process.env.HEADLESS !== "false", // Set to false for debugging
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    });
    const page = await browser.newPage();
    await navigateWithRetries(page, `https://www.google.com/maps/search/${query.split(" ").join("+")}`);
    await delay(5000); // Wait for content to load
    await autoScroll(page);
    const html = await page.content();
    const $ = cheerio.load(html);
    const businesses = [];

    $('a[href*="/maps/place/"]').each((i, el) => {
      try {
        const parent = $(el).parent();
        const url = $(el).attr('href');
        const website = parent.find('a[data-value="Website"]').attr('href');
        const storeName = parent.find('div.fontHeadlineSmall').text().trim();
        const ratingText = parent.find('span[aria-label]').attr('aria-label') || null;
        const detailsText = parent.find('div.fontBodyMedium').first().text().split('·').map(t => t.trim());
        const category = detailsText.length > 0 ? detailsText[0] : null;
        const address = detailsText.length > 1 ? detailsText[1] : null;
        const phone = detailsText.length > 2 ? detailsText[2] : null;
        const placeIdMatch = url?.match(/ChI[\w-]+/);
        const placeId = placeIdMatch ? placeIdMatch[0] : null;

        console.log(`Scraped business #${i + 1}:`, {
          storeName,
          placeId,
          address,
          category,
          phone,
          googleUrl: url,
          bizWebsite: website,
          ratingText,
        });

        businesses.push({
          index: i + 1,
          storeName,
          placeId,
          address,
          category,
          phone,
          googleUrl: url,
          bizWebsite: website,
          ratingText,
        });
      } catch (error) {
        console.warn(`Error parsing business at index ${i}:`, error.message);
      }
    });

    // Sort businesses by rating (handle invalid ratings)
    businesses.sort((a, b) => {
      const ratingA = parseFloat(a.ratingText) || 0;
      const ratingB = parseFloat(b.ratingText) || 0;
      return ratingB - ratingA;
    });

    // Save the businesses data to CSV file
    await saveToCSV(businesses);
    console.log(`Scraped ${businesses.length} businesses successfully.`);
    return businesses;
  } catch (error) {
    console.error('Error while scraping Google Maps:', error.message);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { searchGoogleMaps };