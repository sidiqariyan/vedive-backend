// Updated server code with EJS removed
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
// Email validation import
const EmailValidator = require('./routes/emailValidator'); // Import the EmailValidator class directly

const app = express();

// Initialize email validator with faster settings
// const emailValidator = new EmailValidator({
//   timeout: 2500,     // 4 seconds for SMTP timeout
//   retryAttempts: 1,  // Reduced retry attempts for faster response
//   verbose: false
// });

// Ensure the public directory exists
const publicDir = path.join(__dirname, "public");
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
  console.log(`Created public directory: ${publicDir}`);
}

// Create template-images directory
const templateImagesDir = path.join(__dirname, 'public', 'uploads', 'template-images');
if (!fs.existsSync(templateImagesDir)) {
  fs.mkdirSync(templateImagesDir, { recursive: true });
  console.log('Created directory for template images:', templateImagesDir);
}

const postImagesDir = path.join(__dirname, 'public', 'uploads', 'post-images');
if (!fs.existsSync(postImagesDir)) {
  fs.mkdirSync(postImagesDir, { recursive: true });
  console.log('Created directory for post images:', postImagesDir);
}

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

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
const whitelist = ["https://vedive.com","https://www.vedive.com", "http://localhost:5173"];
const corsOptions = {
  origin: true, // temporarily allow all origins
  credentials: true,
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Middleware
app.use(express.urlencoded({ extended: true }));
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

// Email Validation Routes - Updated to return JSON responses
// Updated Email Validation Routes with improved reliability
// Email Validation Routes - Updated with SMTP-based validation logic
app.get('/email-validation', (req, res) => {
  res.json({
    title: 'Email Validator',
    message: 'Use POST /validate for single email validation or POST /validate-batch for batch validation',
    endpoints: {
      singleValidation: 'POST /validate',
      batchValidation: 'POST /validate-batch',
      apiValidation: 'POST /api/validate',
      quickValidation: 'POST /api/validate-quick'
    }
  });
});

// Initialize EmailValidator with proper settings
const emailValidator = new EmailValidator({
  timeout: 8000,
  retryAttempts: 1,
  verbose: false,
  skipSMTPValidation: false,
  treatGreylistingAsValid: false, // Changed to false for stricter SMTP validation
  fromEmail: 'test@example.com'
});

// Single email validation endpoint
app.post('/validate', async (req, res) => {
  const { email } = req.body;
 
  if (!email) {
    return res.status(400).json({
      error: 'Please enter an email address',
      email: '',
      result: null
    });
  }

  try {
    const result = await emailValidator.validateEmail(email.trim());
    
    // Apply strict SMTP-based validation
    const enhancedResult = {
      ...result,
      isValid: determineValidityStrict(result),
      confidence: calculateConfidenceStrict(result),
      validationType: 'full'
    };
    
    res.json({
      result: enhancedResult,
      email: email,
      success: true
    });
  } catch (error) {
    console.error('Email validation error:', error);
    res.status(500).json({
      error: `Validation failed: ${error.message}`,
      email: email,
      result: {
        isValid: false,
        confidence: 0,
        error: error.message,
        checks: {
          syntax: { passed: false, message: 'Validation error' },
          domain: { passed: false, message: 'Validation error' },
          mx: { passed: false, message: 'Validation error' },
          smtp: { passed: false, message: 'Validation error' }
        }
      }
    });
  }
});

// Batch email validation endpoint
app.post('/validate-batch', async (req, res) => {
  const { emails } = req.body;
 
  if (!emails) {
    return res.status(400).json({ error: 'Please provide emails' });
  }

  try {
    const emailList = emails.split(',').map(email => email.trim()).filter(email => email);
    
    if (emailList.length === 0) {
      return res.status(400).json({ error: 'No valid emails provided' });
    }

    const results = [];
    for (const email of emailList) {
      try {
        const result = await emailValidator.validateEmail(email);
        const enhancedResult = {
          ...result,
          isValid: determineValidityStrict(result),
          confidence: calculateConfidenceStrict(result),
          validationType: 'full'
        };
        results.push(enhancedResult);
      } catch (error) {
        console.error(`Error validating ${email}:`, error);
        results.push({
          email: email,
          isValid: false,
          error: error.message,
          confidence: 0,
          validationType: 'error',
          checks: {
            syntax: { passed: false, message: 'Validation error' },
            domain: { passed: false, message: 'Validation error' },
            mx: { passed: false, message: 'Validation error' },
            smtp: { passed: false, message: 'Validation error' }
          }
        });
      }
    }
    
    res.json({ results, success: true });
  } catch (error) {
    console.error('Batch validation error:', error);
    res.status(500).json({ error: `Batch validation failed: ${error.message}` });
  }
});

// API endpoint for single email validation
app.post('/api/validate', async (req, res) => {
  const { email } = req.body;
 
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const result = await emailValidator.validateEmail(email.trim());
    const enhancedResult = {
      ...result,
      isValid: determineValidityStrict(result),
      confidence: calculateConfidenceStrict(result),
      validationType: 'full'
    };
    
    res.json(enhancedResult);
  } catch (error) {
    console.error('API validation error:', error);
    res.status(500).json({ 
      error: `Validation failed: ${error.message}`,
      isValid: false,
      confidence: 0,
      validationType: 'error'
    });
  }
});

// Quick validation endpoint that skips SMTP entirely
app.post('/api/validate-quick', async (req, res) => {
  const { email } = req.body;
 
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    // Create a quick validator that skips SMTP
    const quickValidator = new EmailValidator({
      skipSMTPValidation: true,
      verbose: false
    });
    
    const result = await quickValidator.validateEmail(email.trim());
    
    res.json({
      ...result,
      confidence: result.isValid ? 75 : 0, // Lower confidence for quick validation
      validationType: 'quick'
    });
  } catch (error) {
    console.error('Quick validation error:', error);
    res.status(500).json({ 
      error: `Quick validation failed: ${error.message}`,
      isValid: false,
      confidence: 0,
      validationType: 'error'
    });
  }
});

// Strict validation function - SMTP must pass for email to be valid
function determineValidityStrict(result) {
  const { checks } = result;
  
  // Must pass syntax check
  if (!checks.syntax.passed) {
    return false;
  }
  
  // Must pass domain check
  if (!checks.domain.passed) {
    return false;
  }
  
  // Must pass MX records check
  if (!checks.mx.passed) {
    return false;
  }
  
  // SMTP check is critical - if it was skipped, consider invalid
  if (checks.smtp.skipped) {
    return false;
  }
  
  // SMTP must pass for email to be considered valid
  if (!checks.smtp.passed) {
    return false;
  }
  
  return true;
}

// Strict confidence calculation
function calculateConfidenceStrict(result) {
  const { checks } = result;
  let confidence = 0;
  
  // Syntax check (20%)
  if (checks.syntax.passed) confidence += 20;
  
  // Domain check (20%)
  if (checks.domain.passed) confidence += 20;
  
  // MX check (25%)
  if (checks.mx.passed) confidence += 25;
  
  // SMTP check (35% - most important)
  if (checks.smtp.skipped) {
    confidence += 0; // No confidence if SMTP was skipped
  } else if (checks.smtp.passed) {
    confidence += 35;
  } else {
    confidence += 0; // No confidence if SMTP failed
  }
  
  return Math.min(confidence, 100);
}

// Alternative lenient validation function (for backward compatibility)
function determineValidityLenient(result) {
  const { checks } = result;
  
  // Must pass syntax and domain checks
  if (!checks.syntax.passed || !checks.domain.passed) {
    return false;
  }
  
  // If MX records don't exist, it's invalid
  if (!checks.mx.passed) {
    return false;
  }
  
  // For SMTP validation, be more lenient
  if (checks.smtp.skipped) {
    return true; // If SMTP was skipped, consider valid if other checks pass
  }
  
  // If SMTP check failed due to timeout or connection issues, still consider valid
  if (!checks.smtp.passed) {
    const smtpMessage = checks.smtp.message.toLowerCase();
    
    // These are definitive rejections - mark as invalid
    const definitiveRejections = [
      'user unknown',
      'mailbox unavailable', 
      'address not found',
      'recipient not found',
      'no such user',
      'invalid recipient',
      'mailbox does not exist'
    ];
    
    const isDefinitiveRejection = definitiveRejections.some(rejection => 
      smtpMessage.includes(rejection)
    );
    
    if (isDefinitiveRejection) {
      return false;
    }
    
    // For all other SMTP failures (timeouts, connection issues, etc.), 
    // consider the email valid if syntax, domain, and MX checks passed
    return true;
  }
  
  return checks.smtp.passed;
}

// Lenient confidence calculation (for backward compatibility)
function calculateConfidenceLenient(result) {
  const { checks } = result;
  let confidence = 0;
  
  if (checks.syntax.passed) confidence += 25;
  if (checks.domain.passed) confidence += 25;
  if (checks.mx.passed) confidence += 25;
  
  if (checks.smtp.skipped) {
    confidence += 15; // Partial confidence when SMTP is skipped
  } else if (checks.smtp.passed) {
    confidence += 25;
  } else {
    // Analyze SMTP failure type
    const smtpMessage = checks.smtp.message.toLowerCase();
    const definitiveRejections = [
      'user unknown', 'mailbox unavailable', 'address not found',
      'recipient not found', 'no such user', 'invalid recipient'
    ];
    
    const isDefinitiveRejection = definitiveRejections.some(rejection => 
      smtpMessage.includes(rejection)
    );
    
    if (!isDefinitiveRejection) {
      confidence += 10; // Some confidence even with SMTP failure if not definitive
    }
  }
  
  return Math.min(confidence, 100);
}

app.post('/validate', async (req, res) => {
  const { email } = req.body;
 
  if (!email) {
    return res.status(400).json({
      error: 'Please enter an email address',
      email: '',
      result: null
    });
  }

  try {
    const result = await emailValidator.validateEmail(email.trim());
    
    // Enhanced validation logic - be more lenient with results
    const enhancedResult = {
      ...result,
      isValid: determineValidityWithLeniency(result),
      confidence: calculateConfidence(result)
    };
    
    res.json({
      result: enhancedResult,
      email: email,
      success: true
    });
  } catch (error) {
    console.error('Email validation error:', error);
    res.status(500).json({
      error: `Validation failed: ${error.message}`,
      email: email,
      result: null
    });
  }
});

app.post('/validate-batch', async (req, res) => {
  const { emails } = req.body;
 
  if (!emails) {
    return res.status(400).json({ error: 'Please provide emails' });
  }

  try {
    const emailList = emails.split(',').map(email => email.trim()).filter(email => email);
    
    if (emailList.length === 0) {
      return res.status(400).json({ error: 'No valid emails provided' });
    }

    // Process emails with better error handling
    const results = [];
    for (const email of emailList) {
      try {
        const result = await emailValidator.validateEmail(email);
        const enhancedResult = {
          ...result,
          isValid: determineValidityWithLeniency(result),
          confidence: calculateConfidence(result)
        };
        results.push(enhancedResult);
      } catch (error) {
        console.error(`Error validating ${email}:`, error);
        results.push({
          email: email,
          isValid: false,
          error: error.message,
          confidence: 0,
          checks: {
            syntax: { passed: false, message: 'Validation error' },
            domain: { passed: false, message: 'Validation error' },
            mx: { passed: false, message: 'Validation error' },
            smtp: { passed: false, message: 'Validation error' }
          }
        });
      }
    }
    
    res.json({ results, success: true });
  } catch (error) {
    console.error('Batch validation error:', error);
    res.status(500).json({ error: `Batch validation failed: ${error.message}` });
  }
});

// API endpoint for single email validation
app.post('/api/validate', async (req, res) => {
  const { email } = req.body;
 
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const result = await emailValidator.validateEmail(email.trim());
    const enhancedResult = {
      ...result,
      isValid: determineValidityWithLeniency(result),
      confidence: calculateConfidence(result)
    };
    
    res.json(enhancedResult);
  } catch (error) {
    console.error('API validation error:', error);
    res.status(500).json({ 
      error: `Validation failed: ${error.message}`,
      isValid: false,
      confidence: 0
    });
  }
});

// Helper function to determine validity with more leniency
function determineValidityWithLeniency(result) {
  const { checks } = result;
  
  // Must pass syntax and domain checks
  if (!checks.syntax.passed || !checks.domain.passed) {
    return false;
  }
  
  // If MX records don't exist, it's invalid
  if (!checks.mx.passed) {
    return false;
  }
  
  // For SMTP validation, be more lenient
  if (checks.smtp.skipped) {
    return true; // If SMTP was skipped, consider valid if other checks pass
  }
  
  // If SMTP check failed due to timeout or connection issues, still consider valid
  if (!checks.smtp.passed) {
    const smtpMessage = checks.smtp.message.toLowerCase();
    
    // These are definitive rejections - mark as invalid
    const definitiveRejections = [
      'user unknown',
      'mailbox unavailable', 
      'address not found',
      'recipient not found',
      'no such user',
      'invalid recipient',
      'mailbox does not exist'
    ];
    
    const isDefinitiveRejection = definitiveRejections.some(rejection => 
      smtpMessage.includes(rejection)
    );
    
    if (isDefinitiveRejection) {
      return false;
    }
    
    // For all other SMTP failures (timeouts, connection issues, etc.), 
    // consider the email valid if syntax, domain, and MX checks passed
    return true;
  }
  
  return checks.smtp.passed;
}

// Helper function to calculate confidence score
function calculateConfidence(result) {
  const { checks } = result;
  let confidence = 0;
  
  if (checks.syntax.passed) confidence += 25;
  if (checks.domain.passed) confidence += 25;
  if (checks.mx.passed) confidence += 25;
  
  if (checks.smtp.skipped) {
    confidence += 15; // Partial confidence when SMTP is skipped
  } else if (checks.smtp.passed) {
    confidence += 25;
  } else {
    // Analyze SMTP failure type
    const smtpMessage = checks.smtp.message.toLowerCase();
    const definitiveRejections = [
      'user unknown', 'mailbox unavailable', 'address not found',
      'recipient not found', 'no such user', 'invalid recipient'
    ];
    
    const isDefinitiveRejection = definitiveRejections.some(rejection => 
      smtpMessage.includes(rejection)
    );
    
    if (!isDefinitiveRejection) {
      confidence += 10; // Some confidence even with SMTP failure if not definitive
    }
  }
  
  return Math.min(confidence, 100);
}

// Alternative quick validation endpoint that skips SMTP entirely
app.post('/api/validate-quick', async (req, res) => {
  const { email } = req.body;
 
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    // Create a quick validator that skips SMTP
    const quickValidator = new EmailValidator({
      skipSMTPValidation: true,
      verbose: false
    });
    
    const result = await quickValidator.validateEmail(email.trim());
    
    res.json({
      ...result,
      confidence: result.isValid ? 85 : 0, // High confidence for quick validation
      validationType: 'quick' // Indicate this was a quick validation
    });
  } catch (error) {
    console.error('Quick validation error:', error);
    res.status(500).json({ 
      error: `Quick validation failed: ${error.message}`,
      isValid: false,
      confidence: 0
    });
  }
});

app.post('/validate', async (req, res) => {
  const { email } = req.body;
 
  if (!email) {
    return res.status(400).json({
      error: 'Please enter an email address',
      email: '',
      result: null
    });
  }

  try {
    const result = await emailValidator.validateEmail(email.trim());
    res.json({
      result: result,
      email: email,
      success: true
    });
  } catch (error) {
    res.status(500).json({
      error: `Validation failed: ${error.message}`,
      email: email,
      result: null
    });
  }
});

app.post('/validate-batch', async (req, res) => {
  const { emails } = req.body;
 
  if (!emails) {
    return res.status(400).json({ error: 'Please provide emails' });
  }

  try {
    const emailList = emails.split(',').map(email => email.trim()).filter(email => email);
    const results = await emailValidator.validateBatch(emailList);
    res.json({ results, success: true });
  } catch (error) {
    res.status(500).json({ error: `Batch validation failed: ${error.message}` });
  }
});

// API endpoint for single email validation
app.post('/api/validate', async (req, res) => {
  const { email } = req.body;
 
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const result = await emailValidator.validateEmail(email.trim());
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: `Validation failed: ${error.message}` });
  }
});

// app.use("/api/admin", require("./routes/adminRoutes"));
// Mount routes
const couponRoutes = require('./routes/coupon');
app.use('/api/coupon', couponRoutes);

const numberScraperRouter = require("./routes/NumberScraper");
app.use("/api/numberScraper", numberScraperRouter);
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/whatsapp", require("./routes/whatsappRoutes"));
app.use("/api", require("./routes/bulkMailSender"));
app.use("/api", require("./routes/scraper"));
app.use("/api", require("./routes/gmailSender"));
app.use("/api/posts", require("./routes/PostRoutes"));

const cashfreeRoute = require("./routes/cashfreeRoute");
// Add these to your existing imports
const SubscriptionPlan = require("./models/SubscriptionPlan");
const Order = require("./models/Order");

// Update your existing app.use statements if needed
app.use("/api/subscription", require("./routes/subscriptionRoute"));
app.use("/api/payment", require("./routes/cashfreeRoute"));
app.use("/api/blog", require("./routes/blogRoute"));
app.use("/api/payment", cashfreeRoute);

const { handleEmailScraper } = require("./routes/scraper");

// Updated Email Scraper Endpoint
app.use("/", require("./routes/campaignRoutes"));
const adminRoutes = require("./routes/adminRoutes");

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
  console.log(`HTTPS Server running on https://vedive.com`);
});
} else {
  console.warn("SSL certificate files not found. Starting server in HTTP mode.");
  http.createServer(app).listen(PORT, () => {
    console.log(`HTTP Server running on port ${PORT}`);
    checkExpiredSubscriptions();
  });
}