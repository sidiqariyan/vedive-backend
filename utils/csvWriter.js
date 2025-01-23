const fs = require("fs");
const path = require("path");
const { createObjectCsvWriter } = require("csv-writer");

async function generateCSV(emails) {
    const csvPath = path.join(__dirname, "..", "emails.csv");

    const csvWriter = createObjectCsvWriter({
        path: csvPath,
        header: [{ id: "email", title: "Email" }],
    });

    const records = emails.map((email) => ({ email }));
    await csvWriter.writeRecords(records);

    return csvPath;
}

module.exports = { generateCSV };
