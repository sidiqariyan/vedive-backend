// csvWriter.js
const { createObjectCsvWriter } = require('csv-writer');
const path = require('path');

async function writeCsv(businesses) {
  const csvWriter = createObjectCsvWriter({
    path: path.join(__dirname, 'businesses.csv'),
    header: [
      { id: 'index', title: 'Index' },
      { id: 'storeName', title: 'Store Name' },
      { id: 'placeId', title: 'Place ID' },
      { id: 'address', title: 'Address' },
      { id: 'category', title: 'Category' },
      { id: 'phone', title: 'Phone' },
      { id: 'googleUrl', title: 'Google URL' },
      { id: 'bizWebsite', title: 'Business Website' },
      { id: 'ratingText', title: 'Rating' },
    ],
  });

  await csvWriter.writeRecords(businesses); // Write the records to CSV file
}

module.exports = { writeCsv };
