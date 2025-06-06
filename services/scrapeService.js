const axios = require("axios");
const puppeteer = require("puppeteer");
const dns = require('dns').promises;
const validator = require("validator");

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

// Enhanced email validation with multiple checks
const validateEmailAdvanced = async (email) => {
  const validation = {
    email: email,
    isValid: false,
    validationScore: 0,
    checks: {
      syntax: false,
      domain: false,
      mxRecord: false,
      disposable: false,
      role: false,
      format: false
    },
    riskLevel: 'high',
    confidence: 0
  };

  try {
    // 1. Basic syntax validation
    validation.checks.syntax = validator.isEmail(email);
    if (validation.checks.syntax) validation.validationScore += 20;

    // 2. Domain format validation
    const domain = email.split('@')[1];
    validation.checks.domain = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9])*$/.test(domain);
    if (validation.checks.domain) validation.validationScore += 15;

    // 3. Check for MX records (indicates valid mail server)
    try {
      const mxRecords = await dns.resolveMx(domain);
      validation.checks.mxRecord = mxRecords && mxRecords.length > 0;
      if (validation.checks.mxRecord) validation.validationScore += 25;
    } catch (error) {
      validation.checks.mxRecord = false;
    }

    // 4. Check for disposable email domains
    const disposableDomains = [
      '10minutemail.com', 'tempmail.org', 'guerrillamail.com', 'mailinator.com',
      'yopmail.com', 'temp-mail.org', 'throwaway.email', 'getnada.com'
    ];
    validation.checks.disposable = !disposableDomains.some(d => domain.toLowerCase().includes(d));
    if (validation.checks.disposable) validation.validationScore += 10;

    // 5. Check for role-based emails (less personal)
    const roleKeywords = ['admin', 'support', 'info', 'contact', 'sales', 'marketing', 'noreply', 'no-reply'];
    const localPart = email.split('@')[0].toLowerCase();
    validation.checks.role = !roleKeywords.some(keyword => localPart.includes(keyword));
    if (validation.checks.role) validation.validationScore += 10;

    // 6. Advanced format checks
    validation.checks.format = !/[<>'"\\]/.test(email) && email.length <= 254;
    if (validation.checks.format) validation.validationScore += 20;

    // Calculate overall validation
    validation.isValid = validation.validationScore >= 60;
    validation.confidence = validation.validationScore;

    // Determine risk level
    if (validation.validationScore >= 80) validation.riskLevel = 'low';
    else if (validation.validationScore >= 60) validation.riskLevel = 'medium';
    else validation.riskLevel = 'high';

  } catch (error) {
    console.error(`Validation error for ${email}:`, error.message);
  }

  return validation;
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

// Extract context around email for better validation
const extractEmailContext = (html, email) => {
  const emailIndex = html.toLowerCase().indexOf(email.toLowerCase());
  if (emailIndex === -1) return { context: '', contactPage: false, aboutPage: false };
  
  const start = Math.max(0, emailIndex - 200);
  const end = Math.min(html.length, emailIndex + email.length + 200);
  const context = html.substring(start, end).replace(/\s+/g, ' ').trim();
  
  // Check if found in contact or about sections
  const contextLower = context.toLowerCase();
  const contactPage = /contact|reach|get in touch|email us|support/i.test(contextLower);
  const aboutPage = /about|team|staff|management|founder|ceo|director/i.test(contextLower);
  
  return { context, contactPage, aboutPage };
};

// Check page credibility
const analyzePageCredibility = (html, url) => {
  const credibility = {
    hasContactInfo: false,
    hasAboutPage: false,
    hasSocialLinks: false,
    hasSSL: url.startsWith('https://'),
    domainAge: 'unknown', // Would need external API
    trustScore: 0
  };

  const htmlLower = html.toLowerCase();
  
  // Check for contact information
  credibility.hasContactInfo = /contact|phone|address|email us|get in touch/i.test(htmlLower);
  if (credibility.hasContactInfo) credibility.trustScore += 20;

  // Check for about page
  credibility.hasAboutPage = /about us|about|our team|our story|who we are/i.test(htmlLower);
  if (credibility.hasAboutPage) credibility.trustScore += 15;

  // Check for social media links
  credibility.hasSocialLinks = /facebook|twitter|linkedin|instagram|youtube/i.test(htmlLower);
  if (credibility.hasSocialLinks) credibility.trustScore += 10;

  // SSL certificate
  if (credibility.hasSSL) credibility.trustScore += 15;

  // Professional domain check
  const domain = new URL(url).hostname;
  const isProfessional = !/blogspot|wordpress|wix|squarespace|weebly/i.test(domain);
  if (isProfessional) credibility.trustScore += 10;

  return credibility;
};

/**
 * Main function to scrape emails with enhanced validation.
 * Returns array of objects with email, source, and validation data.
 */
async function scrapeEmails(query, sites, apiKey, cx, pagesToScrape = 5) {
  console.log("Starting enhanced email scraping with validation...");
  const emailsWithSources = new Map();
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
            const response = await axios.get(link, { timeout: 10000 });
            const html = response.data;
            const found = html.match(emailRegex) || [];
            const validEmails = filterEmails(found);
            
            // Analyze page credibility
            const pageCredibility = analyzePageCredibility(html, link);
            
            // Store each email with enhanced data
            for (const email of validEmails) {
              if (!emailsWithSources.has(email)) {
                const context = extractEmailContext(html, email);
                emailsWithSources.set(email, {
                  source: link,
                  foundAt: new Date().toISOString(),
                  context: context.context.substring(0, 100), // Limit context length
                  foundInContactSection: context.contactPage,
                  foundInAboutSection: context.aboutPage,
                  pageCredibility: pageCredibility,
                  scrapingMethod: 'HTTP'
                });
              }
            }
            
            console.log(`Found ${validEmails.length} valid emails on ${link}`);
            await delay(500); // Be respectful to servers
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
    moreEmailsWithSources.forEach(({ email, data }) => {
      if (!emailsWithSources.has(email)) {
        emailsWithSources.set(email, data);
      }
    });
  }

  // Validate all emails
  console.log("Validating emails...");
  const results = [];
  for (const [email, data] of emailsWithSources.entries()) {
    const validation = await validateEmailAdvanced(email);
    results.push({
      email,
      ...data,
      validation
    });
    
    // Add small delay to avoid overwhelming DNS servers
    await delay(100);
  }

  console.log(`Validation complete. Found ${results.length} emails.`);
  return results;
}

// Enhanced Puppeteer scraping with more context
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
      await page.goto(link, { waitUntil: "domcontentloaded", timeout: 15000 });
      
      // Wait for dynamic content
      await delay(2000);
      
      const content = await page.content();
      const found = content.match(/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g) || [];
      const validEmails = filterEmails(found);
      
      // Analyze page with Puppeteer context
      const pageCredibility = analyzePageCredibility(content, link);
      
      validEmails.forEach((email) => {
        const context = extractEmailContext(content, email);
        emailsWithSources.push({
          email,
          data: {
            source: link,
            foundAt: new Date().toISOString(),
            context: context.context.substring(0, 100),
            foundInContactSection: context.contactPage,
            foundInAboutSection: context.aboutPage,
            pageCredibility: pageCredibility,
            scrapingMethod: 'Puppeteer'
          }
        });
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
