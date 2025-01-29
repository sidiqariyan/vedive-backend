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
async function scrapeEmailsWithPuppeteer(links) {
  const emails = new Set();

  // Launch Puppeteer with necessary arguments
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process'
    ],
    executablePath: process.env.CHROMIUM_PATH || puppeteer.executablePath()
  });

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
