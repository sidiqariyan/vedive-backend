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

const scraper = require("./scraper");
const { writeCsv } = require("./csvWriter");
const emailScraper = require("./routes/scraper");
const gmailSender = require("./routes/gmailSender");

const app = express();
const PORT = process.env.PORT || 3001;
const server = require("http").createServer(app);

// WebSocket server
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/", gmailSender);

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { args: ["--no-sandbox", "--disable-setuid-sandbox"] },
});

// Handle QR Code generation for WhatsApp Web authentication
client.on("qr", (qr) => {
  qrcode.toDataURL(qr, (err, url) => {
    if (!err) {
      wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ qr: url }));
        }
      });
    }
  });
});

client.on("ready", () => {
  console.log("WhatsApp Client is ready!");
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ status: "WhatsApp Client is ready!" }));
    }
  });
});

client.initialize();

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: "./uploads/",
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // Optional: Set file size limit (10MB)
}).fields([
  { name: "messageFile", maxCount: 1 },
  { name: "contactsFile", maxCount: 1 },
  { name: "mediaFile", maxCount: 1 },
]);

/**
 * Reads phone numbers from an uploaded Excel (XLSX) file.
 */
const readPhoneNumbersFromXlsx = (filePath) => {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(sheet);

  return data.map((row) => {
    let phone = row["Phone"] ? row["Phone"].toString().trim() : null;
    if (phone && /^\d+$/.test(phone)) {
      phone = phone.startsWith("+") ? phone : `+${phone}`; // Ensure country code
      phone = phone.replace(/\D/g, ""); // Remove any non-numeric characters
      return `${phone}@c.us`; // Convert to WhatsApp format
    }
    return null;
  }).filter(Boolean);
};

/**
 * API to send bulk WhatsApp messages using an uploaded XLSX file.
 */
app.post("/api/send-whatsapp", upload.fields([{ name: "contactsFile", maxCount: 1 }]), async (req, res) => {
  try {
    const { message } = req.body;

    if (!req.files || !req.files.contactsFile) {
      return res.status(400).json({ error: "Contacts file is required!" });
    }

    if (!message) {
      return res.status(400).json({ error: "Message content is required!" });
    }

    // Read contacts from XLSX file
    const phoneNumbers = readPhoneNumbersFromXlsx(req.files.contactsFile[0].path);
    console.log("Extracted Phone Numbers:", phoneNumbers);

    if (phoneNumbers.length === 0) {
      return res.status(400).json({ error: "No valid phone numbers found in file!" });
    }

    // Send messages
    for (const phoneNumber of phoneNumbers) {
      try {
        await client.sendMessage(phoneNumber, message);
        console.log(`Message sent to ${phoneNumber}`);
      } catch (error) {
        console.error(`Failed to send message to ${phoneNumber}:`, error);
      }
    }

    // Delete uploaded file after processing
    fs.unlinkSync(req.files.contactsFile[0].path);

    res.json({ success: true, message: "WhatsApp messages sent successfully!" });
  } catch (error) {
    console.error("Error sending WhatsApp messages:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


/**
 * Bulk email sending route
 */
app.post(
  "/api/send-bulk-mail",
  upload.fields([{ name: "recipientsFile" }, { name: "htmlTemplate" }]),
  async (req, res) => {
    try {
      const {
        smtpHost,
        smtpPort,
        smtpUsername,
        smtpPassword,
        fromEmail,
        emailSubject,
      } = req.body;

      if (!smtpHost || !smtpPort || !smtpUsername || !smtpPassword || !fromEmail || !emailSubject) {
        return res.status(400).send("Missing required SMTP or email details.");
      }

      const recipientsFile = req.files?.recipientsFile?.[0];
      const htmlTemplateFile = req.files?.htmlTemplate?.[0];

      if (!recipientsFile || !htmlTemplateFile) {
        return res.status(400).send("Recipients file and HTML template file are required.");
      }

      const recipientsData = fs.readFileSync(recipientsFile.path, "utf-8");
      const recipients = recipientsData.split(/\r?\n/).filter((email) => email.trim() !== "");
      const emailBody = fs.readFileSync(htmlTemplateFile.path, "utf-8");

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(smtpPort),
        secure: parseInt(smtpPort) === 465,
        auth: {
          user: smtpUsername,
          pass: smtpPassword,
        },
      });

      for (const recipient of recipients) {
        try {
          await transporter.sendMail({
            from: `${fromEmail} <${smtpUsername}>`,
            to: recipient,
            subject: emailSubject,
            html: emailBody,
          });
          console.log(`Email sent to ${recipient}`);
        } catch (err) {
          console.error(`Failed to send email to ${recipient}:`, err);
          return res.status(500).send(`Failed to send email to ${recipient}: ${err.message}`);
        }
      }

      fs.unlinkSync(recipientsFile.path);
      fs.unlinkSync(htmlTemplateFile.path);

      res.send("Bulk emails sent successfully!");
    } catch (error) {
      console.error("Error sending bulk emails:", error);
      res.status(500).send(`Error: ${error.message}`);
    }
  }
);

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Internal Server Error");
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
