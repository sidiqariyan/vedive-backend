const express = require("express");
const fs = require("fs");
const path = require("path");
const { createObjectCsvWriter } = require("csv-writer");
const puppeteer = require("puppeteer-extra");
const stealthPlugin = require("puppeteer-extra-plugin-stealth");
const { v4: uuidv4 } = require("uuid");

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

async function extractResults(page, selectors) {
  await page.waitForSelector(selectors.item, { timeout: 10000 });
  return page.$$eval(selectors.item, (nodes, sel) => {
    return nodes.map(n => ({
      title:   (n.querySelector(sel.title)?.innerText || "").trim(),
      url:     n.querySelector(sel.url)?.href || "",
      snippet: (n.querySelector(sel.snip)?.innerText || "").trim(),
    }));
  }, selectors);
}

async function searchEngine(page, engine, query, numPages = 3) {
  const all = [];
  for (let i = 0; i < numPages; i++) {
    const url = engine.buildUrl(query, i);
    console.log(`→ [${engine.name}] page ${i + 1}: ${url}`);
    await navigateWithRetries(page, url);
    await delay(1000 + Math.random() * 1000);
    await autoScroll(page);
    let hits = [];
    try {
      hits = await extractResults(page, engine.selectors);
    } catch (e) {
      console.warn(`⚠️ [${engine.name}] no results: ${e.message}`);
    }
    all.push(...hits);
    await delay(500 + Math.random() * 500);
  }
  return all;
}

async function saveToCSV(records) {
  const folder = "public";
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  const file = `search_results_${uuidv4()}.csv`;
  const writer = createObjectCsvWriter({
    path: path.join(folder, file),
    header: [
      { id: "engine", title: "Engine" },
      { id: "title", title: "Title" },
      { id: "url", title: "URL" },
      { id: "snippet", title: "Snippet" },
    ]
  });
  await writer.writeRecords(records);
  return file;
}

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

router.post("/search", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "Missing search query" });

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const all = [];

  for (const engine of ENGINES) {
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/110.0.0.0 Safari/537.36");
    await page.setRequestInterception(true);
    page.on("request", req => {
      if (["image", "media", "font"].includes(req.resourceType())) req.abort();
      else req.continue();
    });

    try {
      const results = await searchEngine(page, engine, query);
      all.push(...results.map(r => ({ engine: engine.name, ...r })));
    } catch (err) {
      console.error(`Error scraping ${engine.name}: ${err.message}`);
    }
    await page.close();
  }

  await browser.close();

  if (!all.length) return res.status(500).json({ error: "No data scraped" });

  const file = await saveToCSV(all);
  res.json({ message: "Search complete", file: `/public/${file}` });
});

module.exports = router;
