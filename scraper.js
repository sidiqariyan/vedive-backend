// scraper.js
const puppeteer = require('puppeteer-extra');
const cheerio = require('cheerio');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

puppeteer.use(stealthPlugin());

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 1000;
      const scrollDelay = 3000;
      
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 700);
    });
  });
}

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

async function saveToCSV(businesses) {
  const csvWriter = createCsvWriter({
    path: 'businesses.csv',  // Path where CSV file will be saved
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

  await csvWriter.writeRecords(businesses);
  console.log('The CSV file was written successfully');
}

async function searchGoogleMaps(query) {
  try {
    const browser = await puppeteer.launch({
      headless: process.env.HEADLESS !== "false",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    });
    const page = await browser.newPage();
    await navigateWithRetries(page, `https://www.google.com/maps/search/${query.split(" ").join("+")}`);

    await delay(5000);
    await autoScroll(page);

    const html = await page.content();
    const $ = cheerio.load(html);
    const businesses = [];

    $('a[href*="/maps/place/"]').each((i, el) => {
      const parent = $(el).parent();
      const url = $(el).attr('href');
      const website = parent.find('a[data-value="Website"]').attr('href');
      const storeName = parent.find('div.fontHeadlineSmall').text();
      const ratingText = parent.find('span[aria-label]').attr('aria-label') || null;
      
      const detailsText = parent.find('div.fontBodyMedium').first().text().split('·').map(t => t.trim());
      const category = detailsText.length > 0 ? detailsText[0] : null;
      const address = detailsText.length > 1 ? detailsText[1] : null;
      const phone = detailsText.length > 2 ? detailsText[2] : null;

      const placeIdMatch = url?.match(/ChI[\w-]+/);
      const placeId = placeIdMatch ? placeIdMatch[0] : null;

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
    });

    businesses.sort((a, b) => (b.ratingText || 0) - (a.ratingText || 0));

    // Save the businesses data to CSV file
    await saveToCSV(businesses);

    await browser.close();
    return businesses;
  } catch (error) {
    console.error('Error while scraping Google Maps:', error);
    return [];
  }
}

module.exports = { searchGoogleMaps };
