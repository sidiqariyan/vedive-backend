require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const passport = require("passport");
const helmet = require("helmet");
const connectDB = require("./db");
const { authenticate } = require("./middleware/authMiddleware");
const nodemailer = require("nodemailer");
const Campaign = require("./models/Campaign");
const { searchGoogleMaps } = require("./routes/NumberScraper"); // Only need searchGoogleMaps
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);

// Connect to MongoDB
connectDB();

// Middleware
app.use(helmet());
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
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl} - Body:`, req.body, "Query:", req.query);
  next();
});

// Helper function to validate email addresses
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return typeof email === "string" && emailRegex.test(email);
};

// Routes from external files
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/whatsapp", require("./routes/whatsappRoutes"));
app.use("/api", require("./routes/bulkMailSender"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api", require("./routes/scraper"));
app.use("/api", require("./routes/gmailSender"));
app.use("/api/posts", require("./routes/postRoutes"));
const campaignRoutes = require("./routes/campaignRoutes");
app.use("/", campaignRoutes);

// Initialize Google OAuth routes
require("./middleware/googleAuth")(app);

// Save businesses to a CSV file in the public directory
async function saveToCSV(businesses) {
  if (!Array.isArray(businesses) || businesses.length === 0) {
    console.error("No businesses data to save.");
    return null;
  }

  const csvFileName = `businesses_${uuidv4()}.csv`;
  const csvFilePath = path.join(downloadsDir, csvFileName);

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
    console.log(`Attempting to write ${businesses.length} records to CSV...`);
    await csvWriter.writeRecords(businesses);
    console.log(`The CSV file "${csvFilePath}" was written successfully.`);
    return csvFileName;
  } catch (error) {
    console.error("Error writing CSV file:", error.message);
    return null;
  }
}

// Create a new campaign
app.post("/api/create-campaign", authenticate, async (req, res) => {
  try {
    const {
      campaignName,
      toolType,
      smtpHost,
      smtpPort,
      smtpUsername,
      smtpPassword,
      fromEmail,
      emailSubject,
      recipients,
      query,
      scrapedNumbers,
      messageContent,
    } = req.body;

    if (!campaignName || !toolType || !fromEmail) {
      return res.status(400).json({ error: "Missing required fields: campaignName, toolType, or fromEmail" });
    }

    let recipientList = [];
    console.log("Processing recipients:", recipients);
    if (Array.isArray(recipients)) {
      recipientList = recipients;
    } else if (typeof recipients === "string" && recipients.trim()) {
      try {
        recipientList = JSON.parse(recipients);
        if (!Array.isArray(recipientList)) {
          return res.status(400).json({ error: "Parsed recipients must be an array" });
        }
      } catch (error) {
        console.error("Failed to parse recipients:", recipients, "Error:", error.message);
        return res.status(400).json({ error: "Invalid recipients format. Expected a JSON array." });
      }
    } else {
      recipientList = [];
    }

    let numbersList = [];
    console.log("Processing scrapedNumbers:", scrapedNumbers);
    if (Array.isArray(scrapedNumbers)) {
      numbersList = scrapedNumbers;
    } else if (typeof scrapedNumbers === "string" && scrapedNumbers.trim()) {
      try {
        numbersList = JSON.parse(scrapedNumbers);
        if (!Array.isArray(numbersList)) {
          return res.status(400).json({ error: "Parsed scrapedNumbers must be an array" });
        }
      } catch (error) {
        console.error("Failed to parse scrapedNumbers:", scrapedNumbers, "Error:", error.message);
        return res.status(400).json({ error: "Invalid scrapedNumbers format. Expected a JSON array." });
      }
    } else {
      numbersList = [];
    }

    if (
      (toolType === "mail-sender" || toolType === "gmail-sender") &&
      recipientList.length > 0 &&
      recipientList.some((email) => !isValidEmail(email))
    ) {
      return res.status(400).json({ error: "Invalid email address in recipients list" });
    }

    const newCampaign = new Campaign({
      userId: req.user._id,
      campaignName,
      toolType,
      smtpHost: smtpHost || "",
      smtpPort: smtpPort ? parseInt(smtpPort) : 587,
      smtpUsername: smtpUsername || "",
      smtpPassword: smtpPassword || "",
      fromEmail,
      emailSubject: emailSubject || "",
      recipients: recipientList,
      query: query || "",
      scrapedNumbers: numbersList,
      messageContent: messageContent || "",
      status: "pending",
    });

    await newCampaign.save();

    res.status(201).json({
      message: "Campaign created successfully",
      campaign: {
        _id: newCampaign._id,
        campaignName: newCampaign.campaignName,
        toolType: newCampaign.toolType,
        fromEmail: newCampaign.fromEmail,
        emailSubject: newCampaign.emailSubject,
        recipients: newCampaign.recipients,
        scrapedNumbers: newCampaign.scrapedNumbers,
        status: newCampaign.status,
        createdAt: newCampaign.createdAt,
      },
    });
  } catch (error) {
    console.error("Error in /create-campaign:", error.stack);
    res.status(500).json({ error: "Failed to create campaign" });
  }
});

// Fetch all campaigns
app.get("/api/campaigns", authenticate, async (req, res) => {
  try {
    const campaigns = await Campaign.find({ userId: req.user._id })
      .select("-smtpPassword")
      .sort({ createdAt: -1 });
    res.status(200).json(campaigns);
  } catch (error) {
    console.error("Error in /campaigns:", error.stack);
    res.status(500).json({ error: "Failed to fetch campaigns" });
  }
});

// Send Gmail emails
app.post("/api/send-gmail", authenticate, async (req, res) => {
  const { gmail, appPassword, from, subject, contacts, body, campaignName } = req.body;

  if (!gmail || !appPassword || !from || !subject || !contacts || !body || !campaignName) {
    return res.status(400).json({ message: "All fields and campaign name are required" });
  }

  let recipientList = [];
  console.log("Processing contacts:", contacts);
  if (Array.isArray(contacts)) {
    recipientList = contacts;
  } else if (typeof contacts === "string" && contacts.trim()) {
    recipientList = contacts.split("\n").map((email) => email.trim()).filter((email) => email);
    console.log("Converted contacts string to array:", recipientList);
  } else {
    return res.status(400).json({ error: "Contacts must be an array or a valid string" });
  }

  const invalidContacts = recipientList.filter((contact) => !isValidEmail(contact));
  if (invalidContacts.length > 0) {
    return res.status(400).json({
      message: "Invalid email addresses found",
      invalidContacts,
    });
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmail, pass: appPassword },
  });

  const sendEmail = async (contact) => {
    try {
      const mailOptions = { from, to: contact, subject, html: body };
      const info = await transporter.sendMail(mailOptions);
      console.log(`Email sent to ${contact}: ${info.response}`);
      return { contact, status: "success", response: info.response };
    } catch (error) {
      console.error(`Failed to send email to ${contact}:`, error.message);
      return { contact, status: "failed", error: error.message };
    }
  };

  try {
    const results = [];
    for (let i = 0; i < recipientList.length; i++) {
      const result = await sendEmail(recipientList[i]);
      results.push(result);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const newCampaign = new Campaign({
      userId: req.user._id,
      campaignName,
      toolType: "gmail-sender",
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
      smtpUsername: gmail,
      smtpPassword: appPassword,
      fromEmail: from,
      emailSubject: subject,
      recipients: recipientList,
      status: results.every((r) => r.status === "success") ? "completed" : "failed",
    });

    await newCampaign.save();

    const failedEmails = results.filter((result) => result.status === "failed");
    if (failedEmails.length > 0) {
      return res.status(207).json({
        message: "Some emails failed to send",
        campaignId: newCampaign._id,
        errors: failedEmails,
      });
    }

    res.status(200).json({
      message: "All emails sent successfully",
      campaignId: newCampaign._id,
    });
  } catch (error) {
    console.error("Error in /send-gmail:", error.stack);
    res.status(500).json({ message: "Error sending emails", error: error.message });
  }
});

// Number Scraper endpoint
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
    console.log("Scraping process started...");
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

    const csvDownloadUrl = `${process.env.BASE_URL || "http://localhost:3000"}/api/download?filename=${csvFileName}`;
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

// Serve CSV File for Download
app.get("/api/download", (req, res) => {
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
app.get("/api/dashboard", authenticate, async (req, res) => {
  try {
    const userId = req.user._id;
    console.log("Fetching dashboard for user:", userId);

    const campaigns = await Campaign.find({ userId });

    res.json({
      message: "Dashboard data retrieved successfully",
      user: req.user,
      campaigns: campaigns || [],
    });
  } catch (error) {
    console.error("Error fetching dashboard data:", error.stack);
    res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
});

// Global Error Handling Middleware
app.use((err, req, res, next) => {
  console.error("Global Error Handler:", err.stack);
  if (err.name === "ValidationError") {
    return res.status(400).json({ error: "Bad Request", details: err.message });
  }
  if (err.name === "UnauthorizedError") {
    return res.status(401).json({ error: "Unauthorized" });
  }
  res.status(500).json({ error: "Internal Server Error" });
});

// Health Check Endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK" });
});

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}).on("error", (err) => {
  console.error("Server failed to start:", err.message);
});
