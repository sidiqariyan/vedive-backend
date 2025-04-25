require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http"); // require http module for fallback
const { v4: uuidv4 } = require("uuid");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const cors = require("cors");
const helmet = require("helmet");
const connectDB = require("./db");
const { authenticate } = require("./middleware/authMiddleware");
const Campaign = require("./models/Campaign");
const User = require("./models/User");
// Updated import: using 'searchGoogle' instead of 'searchGoogleMaps'
const { searchGoogle } = require("./routes/NumberScraper");
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

// Use Helmet for security best practices
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads'), {
  setHeaders: (res) => {
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Access-Control-Allow-Origin', '*');
  }
}));
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);

// CORS configuration
const whitelist = ["https://vedive.com", "http://localhost:5173"];
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || whitelist.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET","POST","PUT","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"]
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));


app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));

// Logging Middleware (custom)
app.use((req, res, next) => {
  const isAuthPath = req.originalUrl.includes("/api/auth");
  let logUrl = req.originalUrl;
  if (isAuthPath && req.originalUrl.includes("?")) {
    logUrl = req.originalUrl.split("?")[0] + "?[REDACTED]";
  }
  console.log(`${new Date().toISOString()} - ${req.method} ${logUrl}`);
  next();
});

// Set secure cookie options for all responses
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
app.use("/api", require("./routes/scraper"));
app.use("/api", require("./routes/gmailSender"));
app.use("/api/posts", require("./routes/PostRoutes"));
app.use("/", require("./routes/campaignRoutes"));

const cashfreeRoute = require("./routes/cashfreeRoute");
const subscriptionRoute = require("./routes/subscriptionRoutes");
app.use("/api/blog", require("./routes/blogRoute"));
app.use("/api/payment", cashfreeRoute);
app.use("/api/subscription", subscriptionRoute);
const { handleEmailScraper } = require("./routes/scraper");
// Updated Email Scraper Endpoint
app.post("/api/email-scraper", authenticate, async (req, res) => {
  try {
    const { query, campaignName } = req.body;
    if (!query || !campaignName) {
      return res.status(400).json({ error: "Query and Campaign Name are required" });
    }
    
    // Add the user ID from the authentication middleware
    req.body.userId = req.user._id;
    
    return await handleEmailScraper(req, res);
  } catch (error) {
    console.error("Error in /api/email-scraper:", error);
    if (!res.headersSent) {
      return res.status(500).json({ error: "An error occurred while scraping emails" });
    }
  }
});

// Function to save scraped data to CSV
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
  try {
    await csvWriter.writeRecords(businesses);
    console.log(`The CSV file "${csvFilePath}" was written successfully.`);
    return csvFileName;
  } catch (error) {
    console.error("Error writing CSV file:", error.message);
    return null;
  }
}

// app.post("/api/numberScraper", authenticate, async (req, res) => {
//   console.log("====== Number Scraper Endpoint Accessed ======");
//   console.log("Request body:", req.body);
//   console.log("User ID:", req.user?._id);
  
//   const { query, campaignName } = req.body; 
  
//   if (!query || !campaignName) {
//     console.log("Missing required fields:", { query, campaignName });
//     return res.status(400).json({ error: "Query and Campaign Name are required" });
//   }
  
//   const userId = req.user?._id;
//   if (!userId) {
//     console.log("Authentication failed: No user ID");
//     return res.status(401).json({ error: "User must be authenticated" });
//   }
  
//   const sanitizeInput = (input) => {
//     if (typeof input !== "string") return "";
//     return input.replace(/[^\w\s]/gi, "").trim().slice(0, 100);
//   };
  
//   const sanitizedQuery = sanitizeInput(query);
//   const sanitizedCampaignName = sanitizeInput(campaignName);
  
//   if (!sanitizedQuery || !sanitizedCampaignName) {
//     console.log("Invalid input after sanitization:", { sanitizedQuery, sanitizedCampaignName });
//     return res.status(400).json({ error: "Invalid query or campaign name after sanitization" });
//   }
  
//   try {
//     // Updated log message and function call to use searchGoogle instead of searchGoogleMaps
//     console.log(`Starting Google search for '${sanitizedQuery}'`);
//     const businesses = await searchGoogle(sanitizedQuery);
    
//     console.log(`Search completed. Found ${businesses?.length || 0} businesses`);
    
//     if (!businesses || businesses.length === 0) {
//       return res.status(404).json({ message: "No businesses found" });
//     }
    
//     const isValidPhoneNumber = (phoneNumber) => {
//       if (typeof phoneNumber !== "string") return false;
//       const phoneRegex = /^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]*$/;
//       return phoneRegex.test(phoneNumber);
//     };
    
//     const phoneNumbers = businesses
//       .map((business) => business.phone || business.phoneNumber)
//       .filter((phoneNumber) => phoneNumber && isValidPhoneNumber(phoneNumber));
    
//     console.log(`Valid phone numbers found: ${phoneNumbers.length}`);
    
//     if (!phoneNumbers || phoneNumbers.length === 0) {
//       return res.status(404).json({ message: "No valid phone numbers found in the scraped data" });
//     }
    
//     const newCampaign = new Campaign({
//       userId,
//       campaignName: sanitizedCampaignName,
//       toolType: "number-scraper",
//       query: sanitizedQuery,
//       scrapedNumbers: phoneNumbers,
//       status: "completed",
//     });
    
//     await newCampaign.save();
//     console.log(`Campaign saved with ID: ${newCampaign._id}`);
    
//     const csvFileName = await saveToCSV(businesses);
//     if (!csvFileName) {
//       console.log("Failed to save CSV file");
//       return res.status(500).json({ error: "Failed to save CSV file" });
//     }
    
//     const csvDownloadUrl = `/api/download?filename=${encodeURIComponent(csvFileName)}`;
//     console.log(`CSV generated: ${csvFileName}`);
    
//     res.status(200).json({
//       message: "Number scraping completed successfully",
//       campaignId: newCampaign._id,
//       businesses,
//       csvFileName,
//       csvDownloadUrl,
//     });
    
//   } catch (error) {
//     console.error("Error in /numberScraper:", error.stack);
//     res.status(500).json({ error: "An error occurred while scraping numbers", details: process.env.NODE_ENV === 'development' ? error.message : undefined });
//   }
// });

// // Secure File Download Endpoint
// app.get("/api/download", authenticate, (req, res) => {
//   const { filename } = req.query;
//   if (!filename) {
//     return res.status(400).json({ error: "File name is required" });
//   }
//   const sanitizedFilename = path.basename(filename);
//   const filePath = path.join(publicDir, sanitizedFilename);
//   if (!fs.existsSync(filePath)) {
//     return res.status(404).json({ error: "File not found" });
//   }
//   res.download(filePath, sanitizedFilename, (err) => {
//     if (err) {
//       console.error("File download error:", err);
//       return res.status(500).json({ error: "Failed to download the file" });
//     }
//     // Cleanup file after download
//     fs.unlink(filePath, (unlinkErr) => {
//       if (unlinkErr) {
//         console.error("Failed to delete file after download:", filePath, unlinkErr);
//       }
//     });
//   });
// });
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
// Dashboard Endpoint
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
    
    // Modified aggregation query to properly count emails
    const emailsCollected = await Campaign.aggregate([
      { $match: { userId, toolType: "email-scraper" } },
      { 
        $project: {
          recipientsCount: { $size: { $ifNull: ["$recipients", []] } }
        }
      },
      { 
        $group: { 
          _id: null, 
          total: { $sum: "$recipientsCount" } 
        } 
      }
    ]);
    
    const phoneNumbers = await Campaign.aggregate([
      { $match: { userId, toolType: "number-scraper" } },
      { 
        $project: {
          numbersCount: { $size: { $ifNull: ["$scrapedNumbers", []] } }
        }
      },
      { 
        $group: { 
          _id: null, 
          total: { $sum: "$numbersCount" } 
        } 
      }
    ]);
    
    const chartData = await Campaign.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: { $dayOfWeek: "$createdAt" },
          sent: { $sum: 1 },
          opened: { $sum: { $cond: [{ $gt: ["$openRate", 0] }, 1, 0] } },
        }
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
        }
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
// Health Check Endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK" });
});

// Global Error Handler
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

// HTTPS configuration using mkcert-generated certificates or fallback to HTTP if not available
const PORT = process.env.PORT || 3000;
const SSL_KEY_PATH = path.join("/", "etc", "letsencrypt", "live", "vedive.com", "privkey.pem");
const SSL_CERT_PATH = path.join("/", "etc", "letsencrypt", "live", "vedive.com", "fullchain.pem");

if (fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH)) {
  const sslOptions = {
    key: fs.readFileSync(SSL_KEY_PATH),
    cert: fs.readFileSync(SSL_CERT_PATH),
  };

  https.createServer(sslOptions, app).listen(PORT, () => {
    console.log(`HTTPS Server running on https://vedive.com:${PORT}`);
    checkExpiredSubscriptions();
  });
} else {
  console.warn("SSL certificate files not found. Starting server in HTTP mode.");
  http.createServer(app).listen(PORT, () => {
    console.log(`HTTP Server running on port ${PORT}`);
    checkExpiredSubscriptions();
  });
}
