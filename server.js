require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const passport = require("passport");
const connectDB = require("./db");
const { authenticate } = require("./middleware/authMiddleware");
const app = express();
const server = http.createServer(app);

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    const allowedOrigins = [process.env.FRONTEND_URL || "http://localhost:5173"];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));
app.use(express.json());
app.use(passport.initialize());

// Static Files
const downloadsDir = path.join(__dirname, "public"); // Ensure public folder exists
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir); // Create the directory if it doesn't exist
}
app.use(express.static(downloadsDir));

// Logging Middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.originalUrl}`);
  next();
});

// Routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/whatsapp", require("./routes/whatsappRoutes"));
app.use("/api", require("./routes/bulkMailSender"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/email-scraper", require("./routes/scraper"));
app.use("/api", require("./routes/gmailSender"));
app.use("/api/posts", require("./routes/postRoutes"));

// Initialize Google OAuth routes
require("./middleware/googleAuth")(app);

// Import Scraper Function
const { searchGoogleMaps } = require("./scraper");
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const { v4: uuidv4 } = require('uuid');

// Save businesses to a CSV file in the public directory
async function saveToCSV(businesses) {
  if (!Array.isArray(businesses) || businesses.length === 0) {
    console.error('No businesses data to save.');
    return null;
  }

  const csvFileName = `businesses_${uuidv4()}.csv`;
  const csvFilePath = path.join(downloadsDir, csvFileName);

  const csvWriter = createCsvWriter({
    path: csvFilePath,
    header: [
      { id: 'index', title: 'Index' },
      { id: 'storeName', title: 'Store Name' },
      { id: 'placeId', title: 'Place ID' },
      { id: 'address', title: 'Address' },
      { id: 'category', title: 'Category' },
      { id: 'phone', title: 'Phone' },
      { id: 'googleUrl', title: 'Google URL' },
      { id: 'bizWebsite', title: 'Business Website' },
      { id: 'ratingText', title: 'Rating' }
    ]
  });

  try {
    console.log(`Attempting to write ${businesses.length} records to CSV...`);
    await csvWriter.writeRecords(businesses);
    console.log(`The CSV file "${csvFilePath}" was written successfully.`);
    return csvFileName; // Return the file name for reference
  } catch (error) {
    console.error('Error writing CSV file:', error.message);
    return null;
  }
}

// Number Scraper Route
app.get("/api/numberScraper", async (req, res) => {
  const { query, campaignName } = req.query;
  if (!query || !campaignName) {
    return res.status(400).json({ error: "Query and Campaign Name are required" });
  }
  try {
    console.log("Scraping process started...");
    const businesses = await searchGoogleMaps(query);
    if (!businesses || businesses.length === 0) {
      return res.status(404).json({ message: "No businesses found" });
    }

    const phoneNumbers = businesses
      .map((business) => business.phone || business.phoneNumber)
      .filter((phoneNumber) => phoneNumber);

    // Import Campaign Model **only when needed**
    const Campaign = require("./models/Campaign");
    const newCampaign = new Campaign({
      campaignName,
      toolType: "number-scraper",
      query,
      scrapedNumbers: phoneNumbers,
    });
    await newCampaign.save();

    // Save CSV file and return the file name
    const csvFileName = await saveToCSV(businesses);
    if (!csvFileName) {
      return res.status(500).json({ error: "Failed to save CSV file" });
    }

    return res.json({ businesses, csvFileName }); // Return both businesses and file name
  } catch (error) {
    console.error("Error in scraping:", error);
    return res.status(500).json({ error: "An error occurred while scraping." });
  }
});

// Serve CSV File for Download
app.get('/api/download', (req, res) => {
  const { filename } = req.query;
  if (!filename) {
    return res.status(400).json({ error: "File name is required" });
  }

  const filePath = path.join(downloadsDir, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  res.download(filePath, filename, (err) => {
    if (err) {
      console.error("File download error:", err);
      return res.status(500).json({ error: "Failed to download the file" });
    }
  });
});

// Protected Dashboard Route
app.get("/api/dashboard", authenticate, (req, res) => {
  res.json({ message: "Welcome to the dashboard!", user: req.user });
});

// Global Error Handling Middleware
app.use((err, req, res, next) => {
  console.error("Global Error Handler:", err.stack);
  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: "Bad Request", details: err.message });
  }
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({ error: "Unauthorized" });
  }
  res.status(500).json({ error: "Internal Server Error" });
});

// Start Server
server.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
}).on("error", (err) => {
  console.error("Server failed to start:", err.message);
});