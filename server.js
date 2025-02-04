const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");
const WebSocket = require("ws");
const nodemailer = require("nodemailer");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const http = require("http");

const app = express();
const PORT = process.env.PORT || 3001;
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Configuration
const MAX_MESSAGE_DELAY_MS = 2000; // 2 seconds between WhatsApp messages
const ALLOWED_MIME_TYPES = ["text/html", "application/html"];

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Initialize WhatsApp Client (Shared for both programs)
const clients = new Map();

const createClient = (userId) => {
  if (clients.has(userId)) return clients.get(userId);

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: userId }),
    puppeteer: { args: ["--no-sandbox", "--disable-setuid-sandbox"], headless: true }
  });

  client.on("qr", (qr) => {
    qrcode.toDataURL(qr, (err, url) => {
      wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "whatsapp_qr", userId, data: url }));
        }
      });
    });
  });

  client.on("ready", () => console.log(`WhatsApp Client Ready for ${userId}`));
  client.on("disconnected", (reason) => {
    console.log(`WhatsApp Client disconnected for ${userId}:`, reason);
    client.initialize();
  });

  client.initialize();
  clients.set(userId, client);
  return client;
};

app.post("/api/connect", (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "User ID is required" });

  createClient(userId);
  res.json({ message: `WhatsApp connection initialized for ${userId}` });
});

// File Upload Setup
const storage = multer.diskStorage({
  destination: "./uploads/",
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }).single("contactsFile");

// WhatsApp Send Message Endpoint
app.post("/api/send-whatsapp", (req, res) => {
  upload(req, res, async (err) => {
    if (err) return res.status(500).json({ error: "File upload error", details: err.message });

    const { userId, message } = req.body;
    const contactsFile = req.file;

    if (!userId || !contactsFile || !message.trim()) {
      return res.status(400).json({ error: "User ID, contacts file, and message are required" });
    }

    const client = clients.get(userId);
    if (!client) return res.status(400).json({ error: "WhatsApp client not initialized. Connect first." });

    try {
      const workbook = xlsx.readFile(contactsFile.path);
      const phoneNumbers = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]])
        .map(row => `${row.Phone}`.replace(/\D/g, ""))
        .filter(Boolean)
        .map(num => `${num}@c.us`);

      if (!phoneNumbers.length) return res.status(400).json({ error: "No valid phone numbers found" });

      const results = { success: [], failures: [] };

      for (const number of phoneNumbers) {
        try {
          await client.sendMessage(number, message);
          results.success.push(number);
        } catch (error) {
          results.failures.push({ number, error: error.message });
        }
      }

      res.json({ sent: results.success.length, failed: results.failures });
    } catch (error) {
      res.status(500).json({ error: "Internal server error", details: error.message });
    }
  });
});

// Email Send Endpoint
app.post("/api/send-bulk-mail", upload.fields([{ name: "recipientsFile", maxCount: 1 }, { name: "htmlTemplate", maxCount: 1 }]), async (req, res) => {
  const results = { success: [], failures: [] };
  let transporter;

  try {
    // Validate inputs
    const requiredFields = ["smtpHost", "smtpPort", "smtpUsername", "smtpPassword", "fromEmail", "emailSubject"];
    const missing = requiredFields.filter(field => !req.body[field]);
    if (missing.length > 0) {
      return res.status(400).json({ error: "Missing required fields", missing });
    }

    // Process files
    const recipientsFile = req.files?.recipientsFile?.[0];
    const htmlTemplateFile = req.files?.htmlTemplate?.[0];
    if (!recipientsFile || !htmlTemplateFile) {
      return res.status(400).json({ error: "Both recipients file and HTML template are required" });
    }

    const recipients = fs.readFileSync(recipientsFile.path, "utf-8")
      .split(/\r?\n/)
      .map(email => email.trim())
      .filter(email => email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/));

    if (recipients.length === 0) {
      return res.status(400).json({ error: "No valid email addresses found" });
    }

    transporter = nodemailer.createTransport({
      host: req.body.smtpHost,
      port: parseInt(req.body.smtpPort),
      secure: req.body.smtpPort === "465",
      auth: { user: req.body.smtpUsername, pass: req.body.smtpPassword }
    });

    await transporter.verify();
    const htmlContent = fs.readFileSync(htmlTemplateFile.path, "utf-8");

    for (const recipient of recipients) {
      try {
        await transporter.sendMail({
          from: `"${req.body.fromEmail}" <${req.body.smtpUsername}>`,
          to: recipient,
          subject: req.body.emailSubject,
          html: htmlContent
        });
        results.success.push(recipient);
      } catch (error) {
        results.failures.push({ recipient, error: error.message });
      }
    }

    res.json({ success: results.failures.length === 0, sent: results.success.length, failed: results.failures });
  } catch (error) {
    res.status(500).json({ error: "Failed to send emails", details: error.message });
  } finally {
    [recipientsFile, htmlTemplateFile].forEach(file => { if (file?.path) fs.unlinkSync(file.path); });
    if (transporter) transporter.close();
  }
});

// WebSocket Status Update
wss.on("connection", (ws) => {
  console.log("WebSocket client connected");
  ws.on("close", () => console.log("WebSocket client disconnected"));
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});
