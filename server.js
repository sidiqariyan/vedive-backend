const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");
const WebSocket = require("ws");
const nodemailer = require("nodemailer");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode");

const scraper = require("./scraper");
const { writeCsv } = require("./csvWriter");
const emailScraper = require("./routes/scraper");
const gmailSender = require("./routes/gmailSender");

const app = express();
const PORT = process.env.PORT || 3001;
const server = require("http").createServer(app);

// WebSocket server should be initialized here without explicitly defining 'upgrade' event
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/", gmailSender);

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { args: ["--no-sandbox", "--disable-setuid-sandbox"] },
});

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
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ status: "WhatsApp Client is ready!" }));
    }
  });
});

client.initialize();

const storage = multer.diskStorage({
  destination: "./uploads/",
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

app.post("/upload", upload.fields([{ name: "messageFile" }, { name: "contactsFile" }, { name: "mediaFile" }]), async (req, res) => {
  try {
    const { messageFile, contactsFile, mediaFile } = req.files;
    
    if (!messageFile || !contactsFile) {
      return res.status(400).send("Message file and contacts file are required.");
    }

    // Read the message file (messageFile is expected to be a .txt file)
    const message = fs.readFileSync(messageFile[0].path, "utf-8");

    // Read the contacts file (contactsFile is expected to be an .xlsx file)
    const contactsData = fs.readFileSync(contactsFile[0].path);
    const workbook = xlsx.read(contactsData, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const contacts = xlsx.utils.sheet_to_json(sheet);
    
    const phoneNumbers = contacts.map((contact) => contact.phoneNumber); // Assuming your contacts file has a 'phoneNumber' field

    // Handle media file (if any)
    let media = null;
    if (mediaFile) {
      const mediaPath = path.join(__dirname, "uploads", mediaFile[0].filename);
      media = MessageMedia.fromFilePath(mediaPath); // Upload the media to WhatsApp
    }

    // Send messages to contacts
    for (const phoneNumber of phoneNumbers) {
      const number = `+${phoneNumber}@c.us`; // WhatsApp number format
      try {
        await client.sendMessage(number, message, { media });
        console.log(`Message sent to ${phoneNumber}`);
      } catch (error) {
        console.error(`Failed to send message to ${phoneNumber}:`, error);
      }
    }

    // Respond to frontend
    res.json({ message: "Messages sent successfully!" });

  } catch (error) {
    console.error("Error in upload route:", error);
    res.status(500).send("Error sending messages. Check logs for details.");
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
