const axios = require("axios");
const puppeteer = require("puppeteer");

// Utility function for delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retry mechanism with exponential backoff
const fetchWithRetry = async (url, retries = 3, delayMs = 2000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await axios.get(url);
    } catch (error) {
      if (error.response?.status === 429 && i < retries - 1) {
        console.log(`Rate limit hit. Retrying in ${delayMs}ms...`);
        await delay(delayMs);
        delayMs *= 2;
      } else {
        throw error;
      }
    }
  }
};

// return true if this email should be excluded
const isExcludedEmail = (email) => {
  const [local, domain] = email.toLowerCase().split("@");
  // 1) anything at google.com or googlegroups.com
  if (/(^|\.)google\.com$/.test(domain) || /(^|\.)googlegroups\.com$/.test(domain)) {
    return true;
  }
  // 2) anything containing literal angle‑brackets
  if (email.includes("<") || email.includes(">")) {
    return true;
  }
  // 3) "malformed" local parts like 10.3617… or u003c… pattern
  //    i.e. purely numeric‑dot or start with "u003c"
  if (/^(?:u003c|\d+\.\d+)/.test(local)) {
    return true;
  }
  return false;
};

// filter an array of emails
const filterEmails = (candidates) =>
  candidates.filter((e) => !isExcludedEmail(e));

/**
 * Main function to scrape emails.
 * Returns array of objects with email and source URL.
 */
async function scrapeEmails(query, sites, apiKey, cx, pagesToScrape = 5) {
  console.log("Starting email scraping...");
  const emailsWithSources = new Map(); // Use Map to avoid duplicates while keeping source info
  const emailRegex = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
  const puppeteerLinks = [];

  for (const site of sites) {
    console.log(`Scraping results for site: ${site}`);
    for (let i = 1; i <= pagesToScrape; i++) {
      const start = (i - 1) * 10 + 1;
      const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=site:${site}+${encodeURIComponent(
        query
      )}&start=${start}`;

      let results;
      try {
        results = (await fetchWithRetry(url)).data.items || [];
      } catch (err) {
        console.error(`Error fetching page ${i}: ${err.message}`);
        break;
      }

      console.log(`→ ${results.length} results on page ${i}`);

      for (const { link } of results) {
        if (site.includes("instagram.com")) {
          puppeteerLinks.push(link);
        } else {
          try {
            const html = (await axios.get(link, { timeout: 5000 })).data;
            const found = html.match(emailRegex) || [];
            const validEmails = filterEmails(found);
            
            // Store each email with its source URL
            validEmails.forEach((email) => {
              if (!emailsWithSources.has(email)) {
                emailsWithSources.set(email, link);
              }
            });
            
            console.log(`Found ${validEmails.length} valid emails on ${link}`);
          } catch (err) {
            console.error(`Error visiting ${link}: ${err.message}`);
          }
        }
      }
      await delay(1000);
    }
  }

  if (puppeteerLinks.length) {
    console.log("Using Puppeteer for restricted sites…");
    const moreEmailsWithSources = await scrapeEmailsWithPuppeteer(puppeteerLinks);
    moreEmailsWithSources.forEach(({ email, source }) => {
      if (!emailsWithSources.has(email)) {
        emailsWithSources.set(email, source);
      }
    });
  }

  // Convert Map to array of objects
  return Array.from(emailsWithSources.entries()).map(([email, source]) => ({
    email,
    source
  }));
}

// Puppeteer fallback for sites like Instagram
async function scrapeEmailsWithPuppeteer(links) {
  const emailsWithSources = [];
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  for (const link of links) {
    try {
      console.log(`Puppeteer visiting: ${link}`);
      await page.goto(link, { waitUntil: "domcontentloaded", timeout: 10000 });
      const content = await page.content();
      const found = content.match(/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g) || [];
      const validEmails = filterEmails(found);
      
      // Store each email with its source URL
      validEmails.forEach((email) => {
        emailsWithSources.push({ email, source: link });
      });
      
      console.log(`Found ${validEmails.length} valid emails on ${link}`);
    } catch (err) {
      console.error(`Error on ${link}: ${err.message}`);
    }
  }

  await browser.close();
  return emailsWithSources;
}

module.exports = { scrapeEmails };
