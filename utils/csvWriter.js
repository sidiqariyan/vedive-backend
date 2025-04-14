const fs = require("fs");
const path = require("path");
const { createObjectCsvWriter } = require("csv-writer");

async function generateCSV(emails) {
  // Build the CSV file path (this example saves it in the parent directory)
  const csvPath = path.join(__dirname, "..", "emails.csv");

  const csvWriter = createObjectCsvWriter({
    path: csvPath,
    header: [{ id: "email", title: "Email" }],
  });

  // Map each email string to an object with the required structure
  const records = emails.map(email => ({ email }));
  await csvWriter.writeRecords(records);

  return csvPath;
}

module.exports = { generateCSV };
