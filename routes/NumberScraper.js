const { searchGoogleMaps } = require('./utils');
const express = require("express");
const router = express.Router();

router.get('/api/numberScraper', async (req, res) => {
  const query = req.query.query;
  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }

  try {
    const businesses = await searchGoogleMaps(query);
    res.json(businesses);
  } catch (error) {
    console.error('Error in scraping:', error);
    res.status(500).json({ error: 'An error occurred while scraping.' });
  }
});

module.exports = { emailScraperRouter: router };
