const puppeteer = require('puppeteer-extra');
const cheerio = require('cheerio');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(stealthPlugin());

// Manual delay function
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    const wrapper = document.querySelector('div[role="feed"]');

    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 1000;
      const scrollDelay = 3000;

      const timer = setInterval(async () => {
        const scrollHeightBefore = wrapper.scrollHeight;
        wrapper.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeightBefore) {
          totalHeight = 0;
          await new Promise(resolve => setTimeout(resolve, scrollDelay));

          const scrollHeightAfter = wrapper.scrollHeight;

          if (scrollHeightAfter > scrollHeightBefore) {
            return;
          } else {
            clearInterval(timer);
            resolve();
          }
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

async function searchGoogleMaps(query) {
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    });
    const page = await browser.newPage();
    await navigateWithRetries(page, `https://www.google.com/maps/search/${query.split(" ").join("+")}`);

    await delay(5000); // Initial wait
    await autoScroll(page); // Scroll and wait for all data to load

    const html = await page.content();
    const $ = cheerio.load(html);
    const aTags = $('a');
    const parents = [];

    aTags.each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.includes('/maps/place/')) {
        parents.push($(el).parent());
      }
    });

    const businesses = [];

    let index = 0;
    parents.forEach((parent) => {
      const url = parent.find('a').attr('href');
      const website = parent.find('a[data-value="Website"]').attr('href');
      const storeName = parent.find('div.fontHeadlineSmall').text();
      const ratingText = parent.find('span.fontBodyMedium > span').attr('aria-label');

      const bodyDiv = parent.find('div.fontBodyMedium').first();
      const children = bodyDiv.children();
      const lastChild = children.last();
      const firstOfLast = lastChild.children().first();
      const lastOfLast = lastChild.children().last();
      
      index += 1;
      businesses.push({
        index,
        storeName,
        placeId: `ChI${url?.split('?')[0]?.split('ChI')[1]}`,
        address: firstOfLast?.text()?.split('·')?.[1]?.trim(),
        category: firstOfLast?.text()?.split('·')?.[0]?.trim(),
        phone: lastOfLast?.text()?.split('·')?.[1]?.trim(),
        googleUrl: url,
        bizWebsite: website,
        ratingText,
      });
    });

    businesses.sort((a, b) => {
      if (a.stars && b.stars) {
        return b.stars - a.stars;
      } else {
        return 0;
      }
    });

    await browser.close();

    return businesses;
  } catch (error) {
    console.error('Error while scraping Google Maps:', error);
    return [];
  }
}

module.exports = { searchGoogleMaps };
