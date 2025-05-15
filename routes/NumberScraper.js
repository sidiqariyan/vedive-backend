const express = require("express");
const fs = require("fs");
const path = require("path");
const { createObjectCsvWriter } = require("csv-writer");
const puppeteer = require('puppeteer-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');
const { v4: uuidv4 } = require('uuid');

puppeteer.use(stealthPlugin());

const router = express.Router();

// Utility: delay
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Auto-scroll page
async function autoScroll(page) {
  await page.evaluate(async () => {
    let totalHeight = 0;
    const distance = 100;
    while (totalHeight < document.body.scrollHeight) {
      window.scrollBy(0, distance);
      totalHeight += distance;
      await new Promise(r => setTimeout(r, Math.floor(Math.random() * 500) + 300));
    }
  });
}

// Retry navigation with captcha detection
async function navigateWithRetries(page, url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      const content = await page.content();
      if (/captcha|unusual traffic/i.test(content)) throw new Error('Blocked by captcha');
      return;
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      const backoff = Math.pow(2, i) * (1500 + Math.random() * 1500);
      await delay(backoff);
    }
  }
}

// Extract Bing search results
async function extractSearchResults(page) {
  await page.waitForSelector('li.b_algo', { timeout: 15000 });
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('li.b_algo')).map((item, idx) => {
      const h2 = item.querySelector('h2');
      const a = item.querySelector('a');
      const p = item.querySelector('p');
      return {
        index: idx + 1,
        title: h2?.innerText.trim() || null,
        url: a?.href || null,
        snippet: p?.innerText.trim() || ""
      };
    });
  });
}

// Perform Bing search
async function searchGoogle(query) {
  if (!query || typeof query !== 'string') throw new Error('Invalid query');
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setRequestInterception(true);
  page.on('request', req => {
    const t = req.resourceType();
    ['image','font','media'].includes(t) ? req.abort() : req.continue();
  });
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  await navigateWithRetries(page, url);
  await delay(3000);
  await autoScroll(page);
  const results = await extractSearchResults(page);
  await browser.close();
  return results;
}

// Save to CSV
async function saveToCSV(records, publicDir) {
  if (!Array.isArray(records) || !records.length) return null;
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
  const filename = `results_${uuidv4()}.csv`;
  const filepath = path.join(publicDir, filename);
  const header = Object.keys(records[0]).map(key => ({ id: key, title: key.charAt(0).toUpperCase() + key.slice(1) }));
  const writer = createObjectCsvWriter({ path: filepath, header });
  await writer.writeRecords(records);
  return filename;
}

// ---------------------------------------------------------------
// Scraper API: Phone Number Scraper (no auth or DB)
// ---------------------------------------------------------------
router.post("/api/numberScraper", async (req, res) => {
  const query  = "fashion store";
  if (!query) return res.status(400).json({ error: "Query is required" });

  try {
    const raw = await searchGoogle(query);
    const phoneRegex = /[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]{7,}/g;
    const numbers = raw
      .flatMap(r => [r.title, r.snippet].join(' ').match(phoneRegex) || [])
      .map(n => n.trim())
      .filter(n => n.length >= 7);

    if (!numbers.length) return res.status(404).json({ message: "No valid phone numbers found" });

    const publicDir = path.join(__dirname, '..', 'public');
    const file = await saveToCSV(numbers.map(n => ({ number: n })), publicDir);
    if (!file) return res.status(500).json({ error: "Failed to save CSV" });

    res.json({ message: "Completed", numbers, csvDownloadUrl: `/api/download?filename=${encodeURIComponent(file)}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error scraping numbers", details: err.message });
  }
});

// ---------------------------------------------------------------
// Scraper API: Search Result Exporter (no auth or DB)
// ---------------------------------------------------------------
router.post("/api/searchScraper", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "Query is required" });

  try {
    const results = await searchGoogle(query);
    if (!results.length) return res.status(404).json({ message: "No search results found" });

    const publicDir = path.join(__dirname, '..', 'public');
    const file = await saveToCSV(results, publicDir);
    if (!file) return res.status(500).json({ error: "Failed to save CSV" });

    res.json({ message: "Completed", resultsCount: results.length, csvDownloadUrl: `/api/download?filename=${encodeURIComponent(file)}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error scraping search", details: err.message });
  }
});

// ---------------------------------------------------------------
// Public CSV File Download (no auth)
// ---------------------------------------------------------------
router.get("/api/download", (req, res) => {
  const { filename } = req.query;
  if (!filename) return res.status(400).json({ error: "Filename is required" });

  const safe = path.basename(filename); // avoid path traversal
  const filePath = path.join(__dirname, '..', 'public', safe);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });

  res.download(filePath, safe, err => {
    if (err) return res.status(500).json({ error: "Download failed" });
    fs.unlink(filePath, () => {}); // delete after download
  });
});

module.exports = router;
