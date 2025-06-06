const fs = require("fs");
const path = require("path");
const { createObjectCsvWriter } = require("csv-writer");

async function generateCSV(emailsWithSources) {
  // Build the CSV file path (this example saves it in the parent directory)
  const csvPath = path.join(__dirname, "..", "emails.csv");
  
  const csvWriter = createObjectCsvWriter({
    path: csvPath,
    header: [
      { id: "email", title: "Email" },
      { id: "source", title: "Source URL" }
    ],
  });

  // Handle both old format (array of strings) and new format (array of objects)
  let records;
  if (emailsWithSources.length > 0 && typeof emailsWithSources[0] === 'string') {
    // Old format - array of email strings
    records = emailsWithSources.map(email => ({ 
      email, 
      source: 'N/A' 
    }));
  } else {
    // New format - array of objects with email and source
    records = emailsWithSources.map(item => ({
      email: item.email,
      source: item.source || 'N/A'
    }));
  }

  await csvWriter.writeRecords(records);
  console.log(`CSV generated with ${records.length} records at: ${csvPath}`);
  return csvPath;
}

module.exports = { generateCSV };
