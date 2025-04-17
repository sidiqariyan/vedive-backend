require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { v4: uuidv4 } = require("uuid");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const cors = require("cors");
const helmet = require("helmet");

const connectDB = require("./db");
const { authenticate } = require("./middleware/authMiddleware");
const Campaign = require("./models/Campaign");
const User = require("./models/User");
const { searchGoogle } = require("./routes/NumberScraper");
const { handleEmailScraper } = require("./routes/scraper");
const { checkExpiredSubscriptions } = require("./utils/subscriptionChecker");

const app = express();

// Ensure the public directory exists
const publicDir = path.join(__dirname, "public");
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
  console.log(`Created public directory: ${publicDir}`);
}

// Connect to MongoDB
connectDB();

// Security and parsing middleware
app.use(helmet());
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));

// Logging middleware
app.use((req, res, next) => {
  const isAuthPath = req.originalUrl.includes("/api/auth");
  let logUrl = req.originalUrl;
  if (isAuthPath && req.originalUrl.includes("?")) {
    logUrl = req.originalUrl.split("?")[0] + "?[REDACTED]";
  }
  console.log(`${new Date().toISOString()} - ${req.method} ${logUrl}`);
  next();
});

// Secure cookies
app.use((req, res, next) => {
  res.cookie("cookieName", "cookieValue", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });
  next();
});

// Mount routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/whatsapp", require("./routes/whatsappRoutes"));
app.use("/api", require("./routes/bulkMailSender"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api", require("./routes/gmailSender"));
app.use("/api/posts", require("./routes/PostRoutes"));
app.use("/", require("./routes/campaignRoutes"));
app.use("/api/blog", require("./routes/blogRoute"));
app.use("/api/payment", require("./routes/cashfreeRoute"));
app.use("/api/subscription", require("./routes/subscriptionRoutes"));

// Email scraper endpoint
app.post("/api/email-scraper", authenticate, async (req, res) => {
  try {
    const { query, campaignName } = req.body;
    if (!query || !campaignName) {
      return res.status(400).json({ error: "Query and Campaign Name are required" });
    }
    req.body.userId = req.user._id;
    return await handleEmailScraper(req, res);
  } catch (error) {
    console.error("Error in /api/email-scraper:", error);
    if (!res.headersSent) {
      return res.status(500).json({ error: "An error occurred while scraping emails" });
    }
  }
});

// Helper: Save scraped businesses data to CSV
async function saveToCSV(businesses) {
  if (!Array.isArray(businesses) || businesses.length === 0) {
    console.error("No businesses data to save.");
    return null;
  }
  const csvFileName = `businesses_${uuidv4()}.csv`;
  const csvFilePath = path.join(publicDir, csvFileName);
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

  const records = businesses.map((biz, idx) => ({
    index: idx + 1,
    storeName: biz.storeName || biz.name || "",
    placeId: biz.placeId || "",
    address: biz.address || "",
    category: biz.category || "",
    phone: biz.phone || biz.phoneNumber || "",
    googleUrl: biz.googleUrl || biz.url || "",
    bizWebsite: biz.bizWebsite || biz.website || "",
    ratingText: biz.ratingText || biz.rating || "",
  }));

  try {
    await csvWriter.writeRecords(records);
    console.log(`CSV file saved: ${csvFilePath}`);
    return csvFileName;
  } catch (error) {
    console.error("Error writing CSV file:", error.message);
    return null;
  }
}

// Number scraper endpoint
app.post("/api/number-scraper", authenticate, async (req, res) => {
  const { query, campaignName } = req.body;
  if (!query || !campaignName) {
    return res.status(400).json({ error: "Query and Campaign Name are required" });
  }
  const userId = req.user._id;
  try {
    console.log(`Starting Google search for '${query}'`);
    const businesses = await searchGoogle(query);
    console.log(`Found ${businesses.length} businesses`);

    if (!businesses.length) {
      return res.status(404).json({ message: "No businesses found" });
    }

    const validPhones = businesses
      .map((b) => b.phone || b.phoneNumber)
      .filter((num) => typeof num === 'string' && /^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]*$/.test(num));

    if (!validPhones.length) {
      return res.status(404).json({ message: "No valid phone numbers found" });
    }

    const newCampaign = new Campaign({
      userId,
      campaignName,
      toolType: "number-scraper",
      query,
      scrapedNumbers: validPhones,
      status: "completed",
    });
    await newCampaign.save();

    const csvFileName = await saveToCSV(businesses);
    if (!csvFileName) {
      return res.status(500).json({ error: "Failed to save CSV file" });
    }

    const csvDownloadUrl = `/api/download?filename=${encodeURIComponent(csvFileName)}`;
    res.status(200).json({
      message: "Number scraping completed successfully",
      campaignId: newCampaign._id,
      businesses,
      csvFileName,
      csvDownloadUrl,
    });
  } catch (error) {
    console.error("Error in /api/number-scraper:", error.stack);
    res.status(500).json({ error: "An error occurred while scraping numbers" });
  }
});

// Secure file download
app.get("/api/download", authenticate, (req, res) => {
  const { filename } = req.query;
  if (!filename) {
    return res.status(400).json({ error: "File name is required" });
  }
  const sanitized = path.basename(filename);
  const filePath = path.join(publicDir, sanitized);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }
  res.download(filePath, sanitized, (err) => {
    if (err) {
      console.error("Download error:", err);
      return res.status(500).json({ error: "Failed to download the file" });
    }
    fs.unlink(filePath, (unlinkErr) => {
      if (unlinkErr) console.error("Failed to delete file:", unlinkErr);
    });
  });
});

// Dashboard endpoint
app.get("/api/dashboard", authenticate, async (req, res) => {
  try {
    const userId = req.user._id;
    const emailCampaigns = await Campaign.countDocuments({ userId, toolType: { $in: ["mail-sender", "gmail-sender"] } });
    const whatsappMessages = await Campaign.countDocuments({ userId, toolType: "whatsapp-bulk-sender" });
    const emailsCollectedAgg = await Campaign.aggregate([
      { $match: { userId, toolType: "email-scraper" } },
      { $project: { count: { $size: { $ifNull: ["$recipients", []] } } } },
      { $group: { _id: null, total: { $sum: "$count" } } },
    ]);
    const phoneNumbersAgg = await Campaign.aggregate([
      { $match: { userId, toolType: "number-scraper" } },
      { $project: { count: { $size: { $ifNull: ["$scrapedNumbers", []] } } } },
      { $group: { _id: null, total: { $sum: "$count" } } },
    ]);

    const chartData = await Campaign.aggregate([
      { $match: { userId } },
      { $group: { _id: { $dayOfWeek: "$createdAt" }, sent: { $sum: 1 }, opened: { $sum: { $cond: [{ $gt: ["$openRate", 0] }, 1, 0] } } } },
      { $project: { _id: 0, name: { $arrayElemAt: [["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], { $subtract: ["$_id", 1] }] }, sent: 1, opened: 1 } },
      { $sort: { name: 1 } },
    ]);

    const recentActivities = await Campaign.find({ userId }).sort({ createdAt: -1 }).limit(5).select("campaignName status createdAt toolType");
    const user = await User.findById(userId);

    res.json({
      stats: {
        emailCampaigns,
        whatsappMessages,
        emailsCollected: emailsCollectedAgg[0]?.total || 0,
        phoneNumbers: phoneNumbersAgg[0]?.total || 0,
      },
      chartData,
      subscriptionInfo: {
        isPaidUser: user.isPaidUser,
        currentPlan: user.currentPlan,
        subscriptionEndDate: user.subscriptionEndDate,
      },
      recentActivities: recentActivities.map((a) => ({ description: `${a.campaignName} (${a.status})`, time: new Date(a.createdAt).toLocaleString(), type: a.toolType })),
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
});

// Health check
app.get("/health", (req, res) => res.status(200).json({ status: "OK" }));

// Global error handler
app.use((err, req, res, next) => {
  console.error("Global Error Handler:", err.stack);
  res.status(500).json({ error: process.env.NODE_ENV === "production" ? "Internal Server Error" : err.message });
});

// Schedule subscription checker hourly
setInterval(() => {
  console.log("Running subscription check...");
  checkExpiredSubscriptions();
}, 60 * 60 * 1000);

// Start HTTP/HTTPS server
const PORT = process.env.PORT || 3000;
const SSL_KEY_PATH = path.join("/etc/letsencrypt/live/vedive.com/privkey.pem");
const SSL_CERT_PATH = path.join("/etc/letsencrypt/live/vedive.com/fullchain.pem");

if (fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH)) {
  const sslOptions = { key: fs.readFileSync(SSL_KEY_PATH), cert: fs.readFileSync(SSL_CERT_PATH) };
  https.createServer(sslOptions, app).listen(PORT, () => {
    console.log(`HTTPS Server running on https://vedive.com:${PORT}`);
    checkExpiredSubscriptions();
  });
} else {
  console.warn("SSL certificates not found, starting HTTP server");
  http.createServer(app).listen(PORT, () => {
    console.log(`HTTP Server running on port ${PORT}`);
    checkExpiredSubscriptions();
  });
}
