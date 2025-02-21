require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const passport = require("passport");
const connectDB = require("./db");
const { authenticate } = require("./middleware/authMiddleware");
const User = require("./models/User"); // Import the User model
const Campaign = require("./models/Campaign"); // Import the Campaign model
const app = express();
const server = http.createServer(app);

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
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
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  next();
});

// Routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/posts", require("./routes/postRoutes"));

// Apply authenticate middleware to protected routes
app.use("/api/dashboard", authenticate, require("./routes/dashboardRoutes")); // Dashboard route
app.use("/api/campaigns", authenticate, require("./routes/campaignRoutes")); // Campaigns route

// Protect all tool-related routes with the authenticate middleware
app.use("/api/whatsapp", authenticate, require("./routes/whatsappRoutes"));
app.use("/api/email-scraper", authenticate, require("./routes/scraper"));
app.use("/api/gmailSender", authenticate, require("./routes/gmailSender"));
app.use("/api/bulkMailSender", authenticate, require("./routes/bulkMailSender"));

// Number Scraper Route (Protected)
app.get("/api/numberScraper", authenticate, async (req, res) => {
  const { query, campaignName } = req.query;

  // Validate required fields
  if (!query || !campaignName) {
    return res.status(400).json({ error: "Query and Campaign Name are required" });
  }

  try {
    console.log("Scraping process started...");
    const businesses = await searchGoogleMaps(query);

    if (!businesses || businesses.length === 0) {
      return res.status(404).json({ message: "No businesses found" });
    }

    // Extract phone numbers from businesses
    const phoneNumbers = businesses
      .map((business) => business.phone || business.phoneNumber)
      .filter((phoneNumber) => phoneNumber);

    // Save campaign data to MongoDB
    const newCampaign = new Campaign({
      campaignName,
      toolType: "number-scraper", // Static name for the Number Scraper tool
      query,
      scrapedNumbers: phoneNumbers,
      userId: req.user._id, // Associate the campaign with the logged-in user
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

// Serve CSV File for Download (Protected)
app.get('/api/download', authenticate, (req, res) => {
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

// Initialize Google OAuth routes
require("./middleware/googleAuth")(app);

// Import Scraper Function
const { searchGoogleMaps } = require("./routes/NumberScraper");
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
app.get('/health', async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping(); // Check MongoDB connection
    res.status(200).json({ status: "OK", dbStatus: "Connected" });
  } catch (error) {
    res.status(500).json({ status: "Error", dbStatus: "Disconnected" });
  }
});

// Start Server
server.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
}).on("error", (err) => {
  console.error("Server failed to start:", err.message);
});