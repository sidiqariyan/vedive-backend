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
const User = require("./models/User");
const { searchGoogleMaps } = require("./routes/NumberScraper");
const rateLimit = require("express-rate-limit");
const { checkExpiredSubscriptions } = require("./utils/subscriptionChecker");
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


// Allow requests from the frontend
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Webhook-Signature"],
    credentials: true,
    exposedHeaders: ["Content-Disposition"],
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Logging Middleware
app.use((req, res, next) => {
  const isAuthPath = req.originalUrl.includes("/api/auth");
  let logUrl = req.originalUrl;
  if (isAuthPath && req.originalUrl.includes("?")) {
    logUrl = req.originalUrl.split("?")[0] + "?[REDACTED]";
  }
  console.log(`${new Date().toISOString()} - ${req.method} ${logUrl}`);
  next();
});

// Mount routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/whatsapp", require("./routes/whatsappRoutes"));
app.use("/api", require("./routes/bulkMailSender"));
app.use("/api/admin", require("./routes/adminRoutes"));
// Mount the scraper router for other scraping routes (if any)
app.use("/api", require("./routes/scraper"));
app.use("/api", require("./routes/gmailSender"));
app.use("/api/posts", require("./routes/postRoutes"));
app.use("/", require("./routes/campaignRoutes"));

const cashfreeRoute = require("./routes/cashfreeRoute");
const subscriptionRoute = require("./routes/subscriptionRoutes");
app.use("/api/payment", cashfreeRoute);
app.use("/api/subscription", subscriptionRoute);

// -------------------------------------------------------------------
// Updated Email Scraper Endpoint using the dedicated handler function
const { handleEmailScraper } = require("./routes/scraper");
app.post("/api/email-scraper", authenticate, async (req, res) => {
  try {
    const { query, campaignName } = req.body;
    if (!query || !campaignName) {
      return res.status(400).json({ error: "Query and Campaign Name are required" });
    }
    return await handleEmailScraper(req, res);
  } catch (error) {
    console.error("Error in /api/email-scraper:", error);
    if (!res.headersSent) {
      return res.status(500).json({ error: "An error occurred while scraping emails" });
    }
  }
});
// -------------------------------------------------------------------

// Function to save scraped data to CSV remains unchanged
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

// Number Scraper Endpoint remains unchanged
app.get("/api/numberScraper", authenticate, async (req, res) => {
  const { query, campaignName } = req.query;
  if (!query || !campaignName) {
    return res.status(400).json({ error: "Query and Campaign Name are required" });
  }
  const userId = req.user?._id;
  if (!userId) {
    return res.status(401).json({ error: "User must be authenticated" });
  }
  const sanitizeInput = (input) => {
    if (typeof input !== "string") return "";
    return input.replace(/[^\w\s]/gi, "").trim().slice(0, 100);
  };
  const sanitizedQuery = sanitizeInput(query);
  const sanitizedCampaignName = sanitizeInput(campaignName);
  if (!sanitizedQuery || !sanitizedCampaignName) {
    return res.status(400).json({ error: "Invalid query or campaign name after sanitization" });
  }
  try {
    const businesses = await searchGoogleMaps(sanitizedQuery);
    if (!businesses || businesses.length === 0) {
      return res.status(404).json({ message: "No businesses found" });
    }
    const isValidPhoneNumber = (phoneNumber) => {
      if (typeof phoneNumber !== "string") return false;
      const phoneRegex = /^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]*$/;
      return phoneRegex.test(phoneNumber);
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
    const csvDownloadUrl = `${baseUrl}/api/download?filename=${encodeURIComponent(csvFileName)}`;
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

// Secure File Download Endpoint remains unchanged
app.get("/api/download", authenticate, (req, res) => {
  const { filename } = req.query;
  if (!filename) {
    return res.status(400).json({ error: "File name is required" });
  }
  const sanitizedFilename = path.basename(filename);
  const filePath = path.join(__dirname, "public", sanitizedFilename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }
  res.download(filePath, sanitizedFilename, (err) => {
    if (err) {
      console.error("File download error:", err);
      return res.status(500).json({ error: "Failed to download the file" });
    }
    // Cleanup file after download
    fs.unlink(filePath, (unlinkErr) => {
      if (unlinkErr) {
        console.error("Failed to delete file after download:", filePath, unlinkErr);
      }
    });
  });
});

// Dashboard Endpoint remains unchanged
app.get("/api/dashboard", authenticate, async (req, res) => {
  try {
    const userId = req.user._id;
    const emailCampaigns = await Campaign.countDocuments({
      userId,
      toolType: { $in: ["mail-sender", "gmail-sender"] },
    });
    const whatsappMessages = await Campaign.countDocuments({
      userId,
      toolType: "whatsapp-bulk-sender",
    });
    const emailsCollected = await Campaign.aggregate([
      { $match: { userId, toolType: "email-scraper" } },
      { $group: { _id: null, total: { $sum: { $size: "$recipients" } } } },
    ]);
    const phoneNumbers = await Campaign.aggregate([
      { $match: { userId, toolType: "number-scraper" } },
      { $group: { _id: null, total: { $sum: { $size: "$scrapedNumbers" } } } },
    ]);
    const chartData = await Campaign.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: { $dayOfWeek: "$createdAt" },
          sent: { $sum: 1 },
          opened: { $sum: { $cond: [{ $gt: ["$openRate", 0] }, 1, 0] } },
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
      { $sort: { _id: 1 } },
    ]);
    const recentActivities = await Campaign.find({ userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("campaignName status createdAt toolType");
    const user = await User.findById(userId);
    const subscriptionInfo = {
      isPaidUser: user.isPaidUser,
      currentPlan: user.currentPlan,
      subscriptionEndDate: user.subscriptionEndDate,
    };
    res.json({
      stats: {
        emailCampaigns,
        whatsappMessages,
        emailsCollected: emailsCollected[0]?.total || 0,
        phoneNumbers: phoneNumbers[0]?.total || 0,
      },
      chartData,
      subscriptionInfo,
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

// Health Check Endpoint remains unchanged
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK" });
});

// Global Error Handling Middleware remains unchanged
app.use((err, req, res, next) => {
  console.error("Global Error Handler:", err.stack);
  if (process.env.NODE_ENV === "production") {
    return res.status(500).json({ error: "Internal Server Error" });
  }
  res.status(500).json({ error: err.message });
});

// Schedule subscription checker to run hourly
setInterval(() => {
  console.log("Running subscription check...");
  checkExpiredSubscriptions();
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  checkExpiredSubscriptions();
}).on("error", (err) => {
  console.error("Server failed to start:", err.message);
});
