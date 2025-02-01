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

const app = express();
const PORT = process.env.PORT || 3001;
const server = require("http").createServer(app);
const wss = new WebSocket.Server({ server });

// Configuration
const MAX_MESSAGE_DELAY_MS = 2000; // 2 seconds between messages
const ALLOWED_MIME_TYPES = ["text/html", "application/html"];

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// WhatsApp Client Setup
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { 
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: true
  },
  takeoverOnConflict: true,
  restartOnAuthFail: true
});

client.on("qr", (qr) => {
  qrcode.toDataURL(qr, (err, url) => {
    wss.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ 
          type: "whatsapp_qr",
          data: url 
        }));
      }
    });
  });
});

client.on("ready", () => {
  console.log("WhatsApp Client ready");
  broadcastStatus("WhatsApp Client ready");
});

client.on("disconnected", (reason) => {
  console.log("WhatsApp Client disconnected:", reason);
  broadcastStatus("Disconnected. Reinitializing...");
  client.initialize();
});

client.initialize();

// Helpers
function broadcastStatus(message) {
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "status_update",
        data: message
      }));
    }
  });
}

function validatePhoneNumber(phone) {
  const cleaned = phone.replace(/[^0-9+]/g, "");
  return cleaned.match(/^\+?[1-9]\d{6,14}$/);
}

// File Upload Setup
const storage = multer.diskStorage({
  destination: "./uploads/",
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "htmlTemplate" && 
        !ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error("Invalid HTML template file type"));
    }
    cb(null, true);
  }
});

// WhatsApp Message Endpoint
app.post("/api/send-whatsapp", 
  upload.fields([{ name: "contactsFile", maxCount: 1 }]),
  async (req, res) => {
    const results = { success: [], failures: [] };
    
    try {
      // Validate client readiness
      if (!client.info?.user) {
        return res.status(425).json({ 
          error: "WhatsApp client not ready. Please authenticate first." 
        });
      }

      // Validate inputs
      const { message } = req.body;
      if (!message?.trim()) {
        return res.status(400).json({ error: "Message content is required" });
      }

      // Process contacts file
      const contactsFile = req.files?.contactsFile?.[0];
      if (!contactsFile) {
        return res.status(400).json({ error: "Contacts file is required" });
      }

      const workbook = xlsx.readFile(contactsFile.path);
      const phoneNumbers = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]])
        .map(row => {
          const phone = row.Phone?.toString().trim() || "";
          return validatePhoneNumber(phone) ? `${phone.replace(/\D/g, "")}@c.us` : null;
        })
        .filter(Boolean);

      if (phoneNumbers.length === 0) {
        return res.status(400).json({ error: "No valid phone numbers found" });
      }

      // Send messages with rate limiting
      for (const [index, number] of phoneNumbers.entries()) {
        try {
          await client.sendMessage(number, message);
          results.success.push(number);
          console.log(`Sent to ${number} (${index + 1}/${phoneNumbers.length})`);
          
          if (index < phoneNumbers.length - 1) {
            await new Promise(resolve => setTimeout(resolve, MAX_MESSAGE_DELAY_MS));
          }
        } catch (error) {
          results.failures.push({
            number,
            error: error.message
          });
          console.error(`Failed to send to ${number}:`, error.message);
        }
      }

      res.json({
        success: results.failures.length === 0,
        sent: results.success.length,
        failed: results.failures
      });
    } catch (error) {
      console.error("WhatsApp send error:", error);
      res.status(500).json({ 
        error: "Internal server error",
        details: error.message 
      });
    } finally {
      if (req.files?.contactsFile) {
        fs.unlinkSync(contactsFile.path);
      }
    }
  }
);

// Email Endpoint
app.post("/api/send-bulk-mail",
  upload.fields([
    { name: "recipientsFile", maxCount: 1 },
    { name: "htmlTemplate", maxCount: 1 }
  ]),
  async (req, res) => {
    const results = { success: [], failures: [] };
    let transporter;

    try {
      // Validate inputs
      const requiredFields = [
        "smtpHost", "smtpPort", "smtpUsername", 
        "smtpPassword", "fromEmail", "emailSubject"
      ];
      
      const missing = requiredFields.filter(field => !req.body[field]);
      if (missing.length > 0) {
        return res.status(400).json({
          error: "Missing required fields",
          missing
        });
      }

      // Process files
      const recipientsFile = req.files?.recipientsFile?.[0];
      const htmlTemplateFile = req.files?.htmlTemplate?.[0];
      
      if (!recipientsFile || !htmlTemplateFile) {
        return res.status(400).json({
          error: "Both recipients file and HTML template are required"
        });
      }

      // Validate email list
      const recipients = fs.readFileSync(recipientsFile.path, "utf-8")
        .split(/\r?\n/)
        .map(email => email.trim())
        .filter(email => email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/));

      if (recipients.length === 0) {
        return res.status(400).json({ error: "No valid email addresses found" });
      }

      // Create transporter
      transporter = nodemailer.createTransport({
        host: req.body.smtpHost,
        port: parseInt(req.body.smtpPort),
        secure: req.body.smtpPort === "465",
        auth: {
          user: req.body.smtpUsername,
          pass: req.body.smtpPassword
        }
      });

      // Verify SMTP connection
      await transporter.verify();

      // Read template
      const htmlContent = fs.readFileSync(htmlTemplateFile.path, "utf-8");

      // Send emails
      for (const recipient of recipients) {
        try {
          await transporter.sendMail({
            from: `"${req.body.fromEmail}" <${req.body.smtpUsername}>`,
            to: recipient,
            subject: req.body.emailSubject,
            html: htmlContent
          });
          results.success.push(recipient);
          console.log(`Email sent to ${recipient}`);
        } catch (error) {
          results.failures.push({
            recipient,
            error: error.message
          });
          console.error(`Failed to send to ${recipient}:`, error.message);
        }
      }

      res.json({
        success: results.failures.length === 0,
        sent: results.success.length,
        failed: results.failures
      });
    } catch (error) {
      console.error("Email send error:", error);
      res.status(500).json({
        error: "Failed to send emails",
        details: error.message
      });
    } finally {
      // Cleanup files
      [recipientsFile, htmlTemplateFile].forEach(file => {
        if (file?.path) fs.unlinkSync(file.path);
      });
      
      // Close transporter
      if (transporter) transporter.close();
    }
  }
);

// Server Start
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  broadcastStatus("Server started");
});

// Error Handling
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});
