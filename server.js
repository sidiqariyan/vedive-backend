require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const passport = require("passport");
const helmet = require("helmet"); // Added security
const connectDB = require("./db");
const { authenticate } = require("./middleware/authMiddleware");

const app = express();
const server = http.createServer(app);

// Connect to MongoDB
connectDB();

// Middleware
app.use(helmet()); // Security middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json());
app.use(passport.initialize());

// Static Files
const downloadsDir = path.join(__dirname, "public");
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir);
}
app.use(express.static(downloadsDir));

// Logging Middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
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

// Import Scraper Function and related utilities
const { searchGoogleMaps } = require("./routes/NumberScraper");
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const { v4: uuidv4 } = require('uuid');
const Campaign = require("./models/Campaign"); // Avoid multiple imports

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
    return csvFileName;
  } catch (error) {
    console.error('Error writing CSV file:', error.message);
    return null;
  }
}

// Number Scraper Route
app.get("/api/numberScraper", authenticate, async (req, res) => {
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

    const newCampaign = new Campaign({
      userId: req.user._id, // Ensure user association
      campaignName,
      toolType: "number-scraper",
      query,
      scrapedNumbers: phoneNumbers,
    });

    await newCampaign.save();

    const csvFileName = await saveToCSV(businesses);
    if (!csvFileName) {
      return res.status(500).json({ error: "Failed to save CSV file" });
    }

    return res.json({ businesses, csvFileName });
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
const campaingRoutes = require("./routes/campaignRoutes")
app.use("/", campaingRoutes)
// Protected Dashboard Route with user-specific campaigns
app.get("/api/dashboard", authenticate, async (req, res) => {
  try {
    const userId = req.user._id;
    console.log("Fetching dashboard for user:", userId);

    const campaigns = await Campaign.find({ userId });

    res.json({
      message: "Dashboard data retrieved successfully",
      user: req.user,
      campaigns: campaigns || []
    });
  } catch (error) {
    console.error("Error fetching dashboard data:", error);
    res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
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

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: "OK" });
});

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}).on("error", (err) => {
  console.error("Server failed to start:", err.message);
});
