require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const helmet = require("helmet");
const connectDB = require("./db");
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
  credentials: true,
}));
app.use(express.json());

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
app.use("/api", require("./routes/scraper"));
app.use("/api", require("./routes/gmailSender"));
app.use("/api/posts", require("./routes/postRoutes"));
app.use("/", require("./routes/campaignRoutes"));
app.use("/api", require("./routes/subscriptionRoutes"));

// Cashfree Routes
const cashfreeRoute = require("./routes/cashfree/cashfree");
app.use("/api", cashfreeRoute);

// Health Check Endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK" });
});

// Global Error Handling Middleware
app.use((err, req, res, next) => {
  console.error("Global Error Handler:", err.stack);
  if (process.env.NODE_ENV === "production") {
    return res.status(500).json({ error: "Internal Server Error" });
  }
  res.status(500).json({ error: err.message });
});
console.log("App ID:", process.env.CASHFREE_APP_ID);
console.log("Secret Key:", process.env.CASHFREE_SECRET_KEY);
// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}).on("error", (err) => {
  console.error("Server failed to start:", err.message);
});