require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const passport = require("passport");
const connectDB = require("./db");
const jwt = require("jsonwebtoken");

// Import Google Auth setup
const googleAuth = require("./middleware/googleAuth");

// Import the authenticate middleware
const { authenticate } = require("./middleware/authMiddleware");

const app = express();
const server = http.createServer(app);

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

// Passport Initialization
app.use(passport.initialize());

// Connect to MongoDB
connectDB();

// Static Files
app.use(express.static(path.join(__dirname, "public")));

// Logging Middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  console.log("Headers:", req.headers);
  next();
});

// Routes
const authRoutes = require("./routes/authRoutes");
const whatsappRoutes = require("./routes/whatsappRoutes");
const emailRoutes = require("./routes/emailRoutes");
const adminRoutes = require("./routes/adminRoutes");
const mailScraper = require("./routes/scraper");
const gmailSender = require("./routes/gmailSender");
const postRoutes = require("./routes/postRoutes");

app.use("/api/auth", authRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/emails", emailRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/email-scraper", mailScraper);
app.use("/api", gmailSender);
app.use("/api/posts", postRoutes);

// Initialize Google OAuth routes
googleAuth(app);

// Logout Route
app.get("/api/auth/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error("Logout Error:", err);
      return res.status(500).json({ error: "Error logging out" });
    }
    res.redirect("/");
  });
});

// Business Scraper Route
app.get('/api/numberScraper', async (req, res) => {
  const query = req.query.query;
  if (!query) return res.status(400).json({ error: 'Query parameter is required' });

  try {
    const businesses = await searchGoogleMaps(query);
    return res.json(businesses);
  } catch (error) {
    console.error('Error in scraping:', error);
    return res.status(500).json({ error: 'An error occurred while scraping.' });
  }
});

// Serve CSV File for Download
app.get('/api/download', (req, res) => {
  const filePath = path.join(__dirname, 'public', 'businesses.csv');

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  res.download(filePath, 'businesses.csv', (err) => {
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