const axios = require("axios");
const puppeteer = require("puppeteer");

// Utility function for delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retry mechanism with exponential backoff
const fetchWithRetry = async (url, retries = 3, delayMs = 2000) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url);
      return response;
    } catch (error) {
      if (error.response && error.response.status === 429 && i < retries - 1) {
        console.log(`Rate limit hit. Retrying in ${delayMs}ms...`);
        await delay(delayMs);
        delayMs *= 2; // Exponential backoff
      } else {
        throw error;
      }
    }
  }
};

// Main function to scrape emails
async function scrapeEmails(query, sites, apiKey, cx, pagesToScrape = 2) {
  console.log("Starting email scraping...");

  const emails = new Set();
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
  const puppeteerLinks = [];

  for (const site of sites) {
    console.log(`Scraping results for site: ${site}`);
    for (let i = 1; i <= pagesToScrape; i++) {
      const start = (i - 1) * 10 + 1;
      const searchURL = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=site:${site} ${encodeURIComponent(query)}&start=${start}`;

      try {
        // Fetch search results with retries
        const response = await fetchWithRetry(searchURL);
        const items = response.data.items || [];

        console.log(`Found ${items.length} results on page ${i}`);

        for (const item of items) {
          if (site.includes("instagram.com")) {
            puppeteerLinks.push(item.link); // Save Instagram links for Puppeteer
          } else {
            try {
              const pageResponse = await axios.get(item.link, { timeout: 5000 });
              const pageContent = pageResponse.data;
              const matches = pageContent.match(emailRegex);
              if (matches) matches.forEach((email) => emails.add(email));
            } catch (err) {
              console.error(`Error visiting ${item.link}: ${err.message}`);
            }
          }
        }
      } catch (error) {
        console.error(`Error fetching search results for page ${i}: ${error.message}`);
        break; // Stop further requests if quota is exceeded
      }

      // Add a delay to avoid hitting rate limits
      await delay(1000);
    }
  }

  // Use Puppeteer for restricted sites like Instagram
  if (puppeteerLinks.length > 0) {
    console.log("Falling back to Puppeteer for restricted sites...");
    const puppeteerEmails = await scrapeEmailsWithPuppeteer(puppeteerLinks);
    puppeteerEmails.forEach((email) => emails.add(email));
  }

  return Array.from(emails);
}

// Puppeteer function for restricted sites
async function scrapeEmailsWithPuppeteer(links) {
  const emails = new Set();
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  for (const link of links) {
    try {
      console.log(`Visiting: ${link}`);
      await page.goto(link, { waitUntil: "domcontentloaded", timeout: 10000 });
      const content = await page.content();
      const matches = content.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g);
      if (matches) matches.forEach((email) => emails.add(email));
    } catch (error) {
      console.error(`Error visiting ${link}: ${error.message}`);
    }
  }

  await browser.close();
  return Array.from(emails);
}

module.exports = { scrapeEmails };
