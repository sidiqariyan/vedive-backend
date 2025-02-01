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
const upload = multer({ storage });

app.post("/upload", upload.fields([{ name: "messageFile" }, { name: "contactsFile" }, { name: "mediaFile" }]), (req, res) => {
  res.json({ message: "Files uploaded successfully!" });
});

// Bulk WhatsApp message sending
app.post("/api/send-whatsapp", async (req, res) => {
  try {
    const { contacts, message, mediaUrl } = req.body;

    if (!contacts || !message) {
      return res.status(400).json({ error: "Contacts and message are required!" });
    }

    console.log("Processing WhatsApp messages...");

    // Validate and format phone numbers
    const phoneNumbers = contacts
      .map((contact) => contact.phoneNumber)
      .filter((number) => number && /^\d+$/.test(number)) // Ensure it's a valid number
      .map((number) => number.startsWith("+") ? number : `+${number}`) // Ensure it has the country code
      .map((number) => `${number.replace(/\D/g, "")}@c.us`); // Convert to WhatsApp format

    console.log("Formatted phone numbers:", phoneNumbers);

    // Send messages
    for (const phoneNumber of phoneNumbers) {
      try {
        await client.sendMessage(phoneNumber, message, { media: mediaUrl });
        console.log(`Message sent to ${phoneNumber}`);
      } catch (error) {
        console.error(`Failed to send message to ${phoneNumber}:`, error);
      }
    }

    res.json({ success: true, message: "Messages sent successfully!" });
  } catch (error) {
    console.error("Error sending WhatsApp messages:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Bulk email sending route
app.post(
  "/api/send-bulk-mail",
  upload.fields([
    { name: "recipientsFile" },
    { name: "htmlTemplate" }
  ]),
  async (req, res) => {
    try {
      const {
        smtpHost,
        smtpPort,
        smtpUsername,
        smtpPassword,
        fromEmail,
        emailSubject
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

// Route to handle search and return results as JSON
app.get("/api/search", async (req, res) => {
  const query = req.query.query;
  let businesses = [];

  if (!query) {
    return res.status(400).send({ message: "Query is required" });
  }

  try {
    businesses = await scraper.searchGoogleMaps(query);
    console.log(businesses);
    await writeCsv(businesses);
    res.json(businesses);
  } catch (error) {
    console.error("Error while scraping data:", error);
    res.status(500).send({ message: "Error while scraping data" });
  }
});

// Route to download the CSV file
app.get("/api/download", (req, res) => {
  const filePath = path.join(__dirname, "businesses.csv");
  res.download(filePath, "business.csv", (err) => {
    if (err) {
      console.error("Error downloading file:", err);
      res.status(500).send("Error downloading file");
    }
  });
});

// Email scraper route
app.use("/api/email-scraper", emailScraper);

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Internal Server Error");
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
