require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const helmet = require("helmet");
const { v4: uuidv4 } = require("uuid");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const connectDB = require("./db");
const { authenticate } = require("./middleware/authMiddleware");
const Campaign = require("./models/Campaign");
const { searchGoogleMaps } = require("./routes/NumberScraper");
const app = express();
const server = http.createServer(app);

// Ensure the public directory exists
const publicDir = path.join(__dirname, "public");
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
  console.log(`Created public directory: ${publicDir}`);
}

// Connect to MongoDB
connectDB();

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"))); // Serve static files from public directory

// Logging Middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  next();
});

// Routes - Only include each route once
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/whatsapp", require("./routes/whatsappRoutes"));
app.use("/api", require("./routes/bulkMailSender"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api", require("./routes/scraper"));
app.use("/api", require("./routes/gmailSender"));
app.use("/api/posts", require("./routes/postRoutes"));
app.use("/", require("./routes/campaignRoutes"));
app.use("/api", require("./routes/subscriptionRoutes"));

// Map the frontend's email-scraper endpoint to the actual scrape-emails endpoint
app.post("/api/email-scraper", async (req, res) => {
  try {
    const { query, campaignName } = req.body;
    
    if (!query || !campaignName) {
      return res.status(400).json({ error: "Query and Campaign Name are required" });
    }

    // Forward the request to the scrape-emails endpoint
    const forwardUrl = `${req.protocol}://${req.get('host')}/api/scrape-emails`;
    
    const response = await fetch(forwardUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': req.headers.authorization
      },
      body: JSON.stringify({
        query,
        campaignName,
        pages: 2,  // Default value
      })
    });
    
    // Forward the response back to the client
    res.status(response.status);
    
    if (response.headers.get('Content-Type').includes('application/octet-stream')) {
      const buffer = await response.arrayBuffer();
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename=emails.csv');
      return res.send(Buffer.from(buffer));
    }
    
    const data = await response.json();
    return res.json(data);
  } catch (error) {
    console.error("Error in /api/email-scraper:", error);
    return res.status(500).json({ error: "An error occurred while scraping emails" });
  }
});

// Cashfree Routes
const cashfreeRoute = require("./routes/cashfree/cashfree");
app.use("/api", cashfreeRoute);

async function saveToCSV(businesses) {
  if (!Array.isArray(businesses) || businesses.length === 0) {
    console.error("No businesses data to save.");
    return null;
  }

  const csvFileName = `businesses_${uuidv4()}.csv`;
  const csvFilePath = path.join(__dirname, "public", csvFileName);

  const csvWriter = createCsvWriter({
    path: csvFilePath,
    header: [
      { id: "index", title: "Index" },
      { id: "storeName", title: "Store Name" },
      { id: "placeId", title: "Place ID" },
      { id: "address", title: "Address" },
      { id: "category", title: "Category" },
      { id: "phone", title: "Phone" },
      { id: "googleUrl", title: "Google URL" },
      { id: "bizWebsite", title: "Business Website" },
      { id: "ratingText", title: "Rating" },
    ],
  });

  try {
    await csvWriter.writeRecords(businesses);
    console.log(`The CSV file "${csvFilePath}" was written successfully.`);
    return csvFileName;
  } catch (error) {
    console.error("Error writing CSV file:", error.message);
    return null;
  }
}

app.get("/api/numberScraper", authenticate, async (req, res) => {
  const { query, campaignName } = req.query;

  if (!query || !campaignName) {
    return res.status(400).json({ error: "Query and Campaign Name are required" });
  }

  const userId = req.user?._id;
  if (!userId) {
    return res.status(401).json({ error: "User must be authenticated" });
  }

  const sanitizeInput = (input) => input.replace(/[^\w\s]/gi, "");
  const sanitizedQuery = sanitizeInput(query);
  const sanitizedCampaignName = sanitizeInput(campaignName);

  try {
    console.log(`Starting Google Maps search for query: ${sanitizedQuery}`);
    const businesses = await searchGoogleMaps(sanitizedQuery);

    if (!businesses || businesses.length === 0) {
      return res.status(404).json({ message: "No businesses found" });
    }

    const isValidPhoneNumber = (phoneNumber) => {
      const phoneRegex = /^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]*$/;
      return typeof phoneNumber === "string" && phoneRegex.test(phoneNumber);
    };

    const phoneNumbers = businesses
      .map((business) => business.phone || business.phoneNumber)
      .filter((phoneNumber) => phoneNumber && isValidPhoneNumber(phoneNumber));

    if (!phoneNumbers || phoneNumbers.length === 0) {
      return res.status(404).json({ message: "No valid phone numbers found in the scraped data" });
    }

    const newCampaign = new Campaign({
      userId,
      campaignName: sanitizedCampaignName,
      toolType: "number-scraper",
      query: sanitizedQuery,
      scrapedNumbers: phoneNumbers,
      status: "completed",
    });

    await newCampaign.save();

    const csvFileName = await saveToCSV(businesses);
    if (!csvFileName) {
      return res.status(500).json({ error: "Failed to save CSV file" });
    }

    const baseUrl = process.env.BASE_URL || "http://localhost:3000";
    const csvDownloadUrl = `${baseUrl}/api/download?filename=${csvFileName}`;
    
    res.status(200).json({
      message: "Number scraping completed successfully",
      campaignId: newCampaign._id,
      businesses,
      csvFileName,
      csvDownloadUrl,
    });
  } catch (error) {
    console.error("Error in /numberScraper:", error.stack);
    res.status(500).json({ error: "An error occurred while scraping numbers" });
  }
});

app.get("/api/download", (req, res) => {
  const { filename } = req.query;
  if (!filename) {
    return res.status(400).json({ error: "File name is required" });
  }

  const filePath = path.join(__dirname, "public", filename);
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

// Dashboard endpoint
app.get("/api/dashboard", authenticate, async (req, res) => {
  try {
    const userId = req.user._id;

    // Fetch stats
    const emailCampaigns = await Campaign.countDocuments({ 
      userId, 
      toolType: { $in: ["mail-sender", "gmail-sender"] } 
    });
    
    const whatsappMessages = await Campaign.countDocuments({ 
      userId, 
      toolType: "whatsapp-bulk-sender" 
    });
    
    const emailsCollected = await Campaign.aggregate([
      { $match: { userId, toolType: "email-scraper" } },
      { $group: { _id: null, total: { $sum: { $size: "$recipients" } } } },
    ]);
    
    const phoneNumbers = await Campaign.aggregate([
      { $match: { userId, toolType: "number-scraper" } },
      { $group: { _id: null, total: { $sum: { $size: "$scrapedNumbers" } } } },
    ]);

    // Fetch chart data (messages sent/opened by day)
    const chartData = await Campaign.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: { $dayOfWeek: "$createdAt" },
          sent: { $sum: 1 },
          opened: { $sum: { $ifNull: ["$openRate", 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          name: {
            $arrayElemAt: [
              ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
              { $subtract: ["$_id", 1] },
            ],
          },
          sent: 1,
          opened: 1,
        },
      },
      { $sort: { _id: 1 } }
    ]);

    // Recent activities
    const recentActivities = await Campaign.find({ userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("campaignName status createdAt toolType");

    res.json({
      stats: {
        emailCampaigns,
        whatsappMessages,
        emailsCollected: emailsCollected[0]?.total || 0,
        phoneNumbers: phoneNumbers[0]?.total || 0,
      },
      chartData,
      recentActivities: recentActivities.map((a) => ({
        description: `${a.campaignName} (${a.status})`,
        time: new Date(a.createdAt).toLocaleString(),
        type: a.toolType,
      })),
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
});

// Health Check Endpoint - only include once
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK" });
});

// Global Error Handling Middleware - only include once
app.use((err, req, res, next) => {
  console.error("Global Error Handler:", err.stack);
  if (process.env.NODE_ENV === "production") {
    return res.status(500).json({ error: "Internal Server Error" });
  }
  res.status(500).json({ error: err.message });
});

// Only log sensitive info in development
if (process.env.NODE_ENV !== "production") {
  console.log("Environment:", process.env.NODE_ENV);
  // Don't log actual secrets, just log that they are available
  if (process.env.CASHFREE_APP_ID) console.log("Cashfree App ID is set");
  if (process.env.CASHFREE_SECRET_KEY) console.log("Cashfree Secret Key is set");
}

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}).on("error", (err) => {
  console.error("Server failed to start:", err.message);
});