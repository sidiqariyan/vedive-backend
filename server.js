require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const session = require("express-session");
const passport = require("./middleware/googleAuth");
const connectDB = require("./db");
const jwt = require("jsonwebtoken");

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173", // Exact frontend origin
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true, // Enable credentials
}));
app.use(express.json());

// Session Middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key",
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: process.env.NODE_ENV === "production", // Use `true` in production (HTTPS)
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", // Required for cross-origin cookies
      maxAge: 24 * 60 * 60 * 1000, // Cookie expires in 24 hours
    },
  })
);

// Passport Initialization
app.use(passport.initialize());
app.use(passport.session());

// Connect to MongoDB
connectDB();

// Static Files
app.use(express.static(path.join(__dirname, "public")));

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

// Google OAuth Routes
app.get(
  "/api/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get(
  "/api/auth/google/callback",
  passport.authenticate("google", { session: false }), // Disable session for JWT-based auth
  (req, res) => {
    if (!req.user) {
      return res.redirect(process.env.FRONTEND_URL || "http://localhost:5173/login");
    }

    // Generate JWT token
    const token = jwt.sign({ userId: req.user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });

    // Redirect to frontend with token as query parameter
    res.redirect(`${process.env.FRONTEND_URL || "http://localhost:5173/dashboard"}?token=${token}`);
  }
);

// Logout Route
app.get("/api/auth/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error("Logout Error:", err);
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
  const filePath = path.join(__dirname, 'businesses.csv');
  res.download(filePath, 'businesses.csv', (err) => {
    if (err) {
      console.error("File download error:", err);
      return res.status(500).json({ error: 'Failed to download the file' });
    }
  });
});

// Global Error Handling Middleware
app.use((err, req, res, next) => {
  console.error("Global Error Handler:", err.stack);
  res.status(500).json({ error: "Internal Server Error" });
});

// Start Server
server.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
}).on("error", (err) => {
  console.error("Server failed to start:", err.message);
});