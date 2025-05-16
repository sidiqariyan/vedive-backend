const express = require("express");
const fs = require("fs");
const path = require("path");
const { createObjectCsvWriter } = require("csv-writer");
const puppeteer = require("puppeteer-extra");
const stealthPlugin = require("puppeteer-extra-plugin-stealth");
const { v4: uuidv4 } = require("uuid");
const validator = require("validator");
const pLimit = require("p-limit");

// Import campaign model and CSV utility
const Campaign = require("../models/Campaign");
const { generateCSV } = require("../utils/csvWriter");

const router = express.Router();
puppeteer.use(stealthPlugin());
const delay = ms => new Promise(res => setTimeout(res, ms));

async function autoScroll(page) {
  await page.evaluate(async () => {
    let total = 0;
    const dist = 100;
    while (total < document.body.scrollHeight) {
      window.scrollBy(0, dist);
      total += dist;
      await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
    }
  });
}
async function navigateWithRetries(page, url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const html = await page.content();
      if (/captcha|unusual traffic/i.test(html)) throw new Error("Blocked by CAPTCHA");
      return;
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      await delay(Math.pow(2, i) * (1000 + Math.random() * 1000));
    }
  }
}
async function searchEngine(page, engine, query, pages) {
  const results = [];
  for (let i = 0; i < pages; i++) {
    const url = engine.buildUrl(query, i);
    await navigateWithRetries(page, url);
    await delay(1000 + Math.random() * 1000);
    await autoScroll(page);
    try {
      const hits = await page.$$eval(engine.selectors.item, (nodes, sel) =>
        nodes.map(n => n.innerText).filter(Boolean)
      , engine.selectors);
      results.push(...hits);
    } catch (e) {
      console.warn(`⚠️ [${engine.name}] no results: ${e.message}`);
    }
    await delay(500 + Math.random() * 500);
  }
  return results;
}

// Define search engines (as before)
const ENGINES = [
  {
    name: "Google",
    buildUrl: (q, i) => `https://www.google.com/search?q=${encodeURIComponent(q)}&start=${i * 10}`,
    selectors: {
      item: "div.g",
      title: "h3",
      url: "a",
      snip: "div.IsZvec, div.yDYNvb",
    },
  },
  {
    name: "Bing",
    buildUrl: (q, i) => `https://bing.com/search?q=${encodeURIComponent(q)}&first=${i * 10 + 1}`,
    selectors: {
      item: "li.b_algo",
      title: "h2",
      url: "h2 > a",
      snip: "p",
    },
  },
  {
    name: "DuckDuckGo",
    buildUrl: (q, i) => `https://duckduckgo.com/html?q=${encodeURIComponent(q)}&s=${i * 10}`,
    selectors: {
      item: "div.result",
      title: "a.result__a",
      url: "a.result__a",
      snip: "a.result__snippet",
    },
  },
  {
    name: "Startpage",
    buildUrl: (q, i) => `https://www.startpage.com/sp/search?q=${encodeURIComponent(q)}&page=${i + 1}`,
    selectors: {
      item: "div.w-gl__result",
      title: "a.w-gl__result-title",
      url: "a.w-gl__result-title",
      snip: "p.w-gl__description",
    },
  },
  {
    name: "Yandex",
    buildUrl: (q, i) => `https://yandex.com/search/?text=${encodeURIComponent(q)}&p=${i}`,
    selectors: {
      item: "li.serp-item",
      title: "h2 > a",
      url: "h2 > a",
      snip: "div.Text",
    },
  },
  {
    name: "Mojeek",
    buildUrl: (q, i) => `https://www.mojeek.com/search?q=${encodeURIComponent(q)}&page=${i + 1}`,
    selectors: {
      item: "div.result",
      title: "h2 > a",
      url: "h2 > a",
      snip: "p.snippet",
    },
  },
  {
    name: "Brave",
    buildUrl: (q, i) => `https://search.brave.com/search?q=${encodeURIComponent(q)}&page=${i + 1}`,
    selectors: {
      item: "div.snippet-description",
      title: "a",
      url: "a",
      snip: "p",
    },
  },
  {
    name: "Ecosia",
    buildUrl: (q, i) => `https://www.ecosia.org/search?q=${encodeURIComponent(q)}&p=${i}`,
    selectors: {
      item: "div.result",
      title: "a.result-title",
      url: "a.result-title",
      snip: "p.result-snippet",
    },
  },
  {
    name: "Yahoo",
    buildUrl: (q, i) => `https://search.yahoo.com/search?p=${encodeURIComponent(q)}&b=${i * 10 + 1}`,
    selectors: {
      item: "div.dd.algo",
      title: "h3.title",
      url: "h3.title > a",
      snip: "div.compText p",
    },
  },
  {
    name: "Qwant",
    buildUrl: (q, i) => `https://www.qwant.com/?q=${encodeURIComponent(q)}&t=web&p=${i + 1}`,
    selectors: {
      item: "div[data-testid='result']",
      title: "h3",
      url: "a",
      snip: "p",
    },
  },
  {
    name: "MetaGer",
    buildUrl: (q, i) => `https://metager.org/meta/meta.ger3?eingabe=${encodeURIComponent(q)}&focus=web&start=${i * 10}`,
    selectors: {
      item: "article.result",
      title: "h2 a",
      url: "h2 a",
      snip: "p.description",
    },
  },
  {
    name: "Peekier",
    buildUrl: (q, i) => `https://peekier.com/#!${encodeURIComponent(q)}?page=${i + 1}`,
    selectors: {
      item: "div.result",
      title: "a.title",
      url: "a.title",
      snip: "div.snippet",
    },
  },
  {
    name: "SearXNG",
    buildUrl: (q, i) => `https://searxng.example.com/search?q=${encodeURIComponent(q)}&page=${i + 1}`, // Replace with actual instance
    selectors: {
      item: "article.result",
      title: "h3 a",
      url: "h3 a",
      snip: "p.content",
    },
  },
  {
    name: "Swisscows",
    buildUrl: (q, i) => `https://swisscows.com/web?query=${encodeURIComponent(q)}&page=${i + 1}`,
    selectors: {
      item: "div.item",
      title: "h2 a",
      url: "h2 a",
      snip: "div.description",
    },
  },
  {
    name: "Gigablast",
    buildUrl: (q, i) => `http://gigablast.com/search?q=${encodeURIComponent(q)}&s=${i * 10}`,
    selectors: {
      item: "div.result",
      title: "a.title",
      url: "a.title",
      snip: "span.summary",
    },
  },
  {
    name: "Gibiru",
    buildUrl: (q, i) => `https://gibiru.com/results.html?q=${encodeURIComponent(q)}&page=${i + 1}`,
    selectors: {
      item: "div.result",
      title: "a.title",
      url: "a.title",
      snip: "div.snippet",
    },
  },
  {
    name: "Search Encrypt",
    buildUrl: (q, i) => `https://www.searchencrypt.com/search?q=${encodeURIComponent(q)}&page=${i + 1}`,
    selectors: {
      item: "div.result",
      title: "h3 a",
      url: "h3 a",
      snip: "p.snippet",
    },
  },
  {
    name: "Oscobo",
    buildUrl: (q, i) => `https://oscobo.com/search?q=${encodeURIComponent(q)}&page=${i + 1}`,
    selectors: {
      item: "div.result",
      title: "a.title",
      url: "a.title",
      snip: "div.description",
    },
  },
  {
    name: "Yippy",
    buildUrl: (q, i) => `https://yippy.com/search?q=${encodeURIComponent(q)}&p=${i}`,
    selectors: {
      item: "div.result",
      title: "a.title",
      url: "a.title",
      snip: "div.snippet",
    },
  },
  {
    name: "Boardreader",
    buildUrl: (q, i) => `https://boardreader.com/s/${encodeURIComponent(q)}.html?p=${i + 1}`,
    selectors: {
      item: "div.result",
      title: "a.title",
      url: "a.title",
      snip: "div.summary",
    },
  },
  {
    name: "Kiddle",
    buildUrl: (q, i) => `https://www.kiddle.co/s.php?q=${encodeURIComponent(q)}&page=${i + 1}`,
    selectors: {
      item: "div.result",
      title: "h3 a",
      url: "h3 a",
      snip: "div.description",
    },
  },
  {
    name: "JustWatch",
    buildUrl: (q, i) => `https://www.justwatch.com/us/search?q=${encodeURIComponent(q)}&page=${i + 1}`,
    selectors: {
      item: "div.result-item",
      title: "a.title",
      url: "a.title",
      snip: "div.description",
    },
  },
  {
    name: "Giphy",
    buildUrl: (q, i) => `https://giphy.com/search/${encodeURIComponent(q)}?page=${i + 1}`,
    selectors: {
      item: "div.gif",
      title: "a.title",
      url: "a.title",
      snip: "div.caption",
    },
  },
  {
    name: "Thangs",
    buildUrl: (q, i) => `https://thangs.com/search/${encodeURIComponent(q)}?page=${i + 1}`,
    selectors: {
      item: "div.result",
      title: "a.title",
      url: "a.title",
      snip: "div.description",
    },
  },
  {
    name: "Infotiger",
    buildUrl: (q, i) => `https://www.infotiger.com/search?q=${encodeURIComponent(q)}&page=${i + 1}`,
    selectors: {
      item: "div.result",
      title: "a.title",
      url: "a.title",
      snip: "div.snippet",
    },
  },
  {
    name: "Petal Search",
    buildUrl: (q, i) => `https://petalsearch.com/search?query=${encodeURIComponent(q)}&page=${i + 1}`,
    selectors: {
      item: "div.result",
      title: "h3 a",
      url: "h3 a",
      snip: "p.description",
    },
  },
  {
    name: "Ask.com",
    buildUrl: (q, i) => `https://www.ask.com/web?q=${encodeURIComponent(q)}&page=${i + 1}`,
    selectors: {
      item: "div.result",
      title: "a.result-title",
      url: "a.result-title",
      snip: "p.result-snippet",
    },
  },
  {
    name: "Neeva",
    buildUrl: (q, i) => `https://neeva.com/search?q=${encodeURIComponent(q)}&page=${i + 1}`,
    selectors: {
      item: "div.result",
      title: "a.title",
      url: "a.title",
      snip: "div.snippet",
    },
  },
  {
    name: "Ahmia",
    buildUrl: (q, i) => `https://ahmia.fi/search/?q=${encodeURIComponent(q)}&page=${i + 1}`, // Requires Tor
    selectors: {
      item: "li.result",
      title: "a.title",
      url: "a.title",
      snip: "div.description",
    },
  },
  {
    name: "Exalead",
    buildUrl: (q, i) => `https://www.exalead.com/search/web/results/?q=${encodeURIComponent(q)}&p=${i}`,
    selectors: {
      item: "div.result",
      title: "a.title",
      url: "a.title",
      snip: "div.description",
    },
  },
  {
    name: "Fireball",
    buildUrl: (q, i) => `https://www.fireball.de/query?query=${encodeURIComponent(q)}&page=${i + 1}`,
    selectors: {
      item: "div.result",
      title: "a.title",
      url: "a.title",
      snip: "div.snippet",
    },
  },
  {
    name: "Lycos",
    buildUrl: (q, i) => `https://www.lycos.com/search?q=${encodeURIComponent(q)}&page=${i + 1}`,
    selectors: {
      item: "div.result",
      title: "a.title",
      url: "a.title",
      snip: "div.description",
    },
  },
  {
    name: "Seznam.cz",
    buildUrl: (q, i) => `https://search.seznam.cz/?q=${encodeURIComponent(q)}&p=${i}`,
    selectors: {
      item: "div.result",
      title: "h3 a",
      url: "h3 a",
      snip: "p.description",
    },
  },
  {
    name: "WebCrawler",
    buildUrl: (q, i) => `https://www.webcrawler.com/serp?q=${encodeURIComponent(q)}&page=${i + 1}`,
    selectors: {
      item: "div.result",
      title: "a.title",
      url: "a.title",
      snip: "div.snippet",
    },
  },
  {
    name: "You.com",
    buildUrl: (q, i) => `https://you.com/search?q=${encodeURIComponent(q)}&page=${i + 1}`,
    selectors: {
      item: "div.result",
      title: "h3 a",
      url: "h3 a",
      snip: "p.snippet",
    },
  },
  {
    name: "Perplexity",
    buildUrl: (q, i) => `https://www.perplexity.ai/search?q=${encodeURIComponent(q)}&page=${i + 1}`,
    selectors: {
      item: "div.result",
      title: "a.title",
      url: "a.title",
      snip: "div.summary",
    },
  },
  {
    name: "Andi",
    buildUrl: (q, i) => `https://andisearch.com/search?q=${encodeURIComponent(q)}&page=${i + 1}`,
    selectors: {
      item: "div.result",
      title: "h3 a",
      url: "h3 a",
      snip: "p.description",
    },
  },
  {
    name: "Tineye",
    buildUrl: (q, i) => `https://tineye.com/search/?query=${encodeURIComponent(q)}&page=${i + 1}`,
    selectors: {
      item: "div.result",
      title: "a.title",
      url: "a.title",
      snip: "div.description",
    },
  },
  {
    name: "Baidu",
    buildUrl: (q, i) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}&pn=${i * 10}`,
    selectors: {
      item: "div.result",
      title: "h3 a",
      url: "h3 a",
      snip: "div.c-abstract",
    },
  },
];

// Handler for number scraping
const handleNumberScraper = async (req, res) => {
  try {
    let { query, pages = 3, domains, campaignName, userId } = req.body;
    // Validate inputs
    if (!query || typeof query !== 'string') return res.status(400).json({ error: 'Invalid or missing query parameter' });
    if (!campaignName || typeof campaignName !== 'string') return res.status(400).json({ error: 'Invalid or missing campaignName parameter' });
    if (pages && (typeof pages !== 'number' || pages <= 0 || pages > 10)) return res.status(400).json({ error: 'Pages must be a positive number between 1 and 10' });
    if (domains && !Array.isArray(domains)) return res.status(400).json({ error: 'Domains must be an array' });

    const userIdentifier = req.user?._id || userId || 'anonymous';
    const customDomains = domains || [];
    const allDomains = [...new Set(customDomains)];
    const domainPattern = allDomains.length ? allDomains.join('|') : null;

    const limit = pLimit(1);
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
    const rawResults = [];
    for (const engine of ENGINES) {
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 ...');
      await page.setRequestInterception(true);
      page.on('request', r => ['image','media','font'].includes(r.resourceType()) ? r.abort() : r.continue());
      try {
        const texts = await limit(() => searchEngine(page, engine, query, pages));
        rawResults.push(...texts.map(text => ({ engine: engine.name, text })));
      } catch (err) {
        console.error(`Error scraping ${engine.name}: ${err.message}`);
      }
      await page.close();
    }
    await browser.close();

    // Extract phone numbers using regex
    const phoneRegex = /\+?\d[\d\s().-]{7,}\d/g;
    let numbers = rawResults
      .flatMap(r => (r.text.match(phoneRegex) || []))
      .map(num => num.trim());
    if (domainPattern) {
      const domainFilter = new RegExp(domainPattern.replace('.', '\\.'), 'i');
      numbers = numbers.filter(n => domainFilter.test(n));
    }
    numbers = [...new Set(numbers)];
    const validNumbers = numbers.filter(n => validator.isMobilePhone(n.replace(/[^\d+]/g, ''), 'any'));
    if (!validNumbers.length) return res.status(404).json({ message: 'No valid phone numbers found.' });

    // Save campaign
    if (userIdentifier !== 'anonymous') {
      const campaign = new Campaign({ userId: userIdentifier, campaignName, toolType: 'number-scraper', query, recipients: validNumbers, status: 'completed' });
      await campaign.save();
    }

    // Generate CSV
    const csvPath = await generateCSV(validNumbers);
    if (!csvPath) return res.status(500).json({ error: 'Failed to generate CSV' });

    // Stream file
    res.setHeader('Content-Type','application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename=numbers-${Date.now()}.csv`);
    const stream = fs.createReadStream(csvPath);
    stream.pipe(res);
    stream.on('close', () => fs.unlink(csvPath, () => {}));
    stream.on('error', err => { console.error(err); if (!res.headersSent) res.status(500).json({ error: 'Stream error' }); });
  } catch (error) {
    console.error('Error in number scraper:', error);
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
};

router.post('/scrape-numbers', handleNumberScraper);
module.exports = router;
