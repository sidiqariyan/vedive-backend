const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");
const { Client, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const WebSocket = require("ws");
const scraper = require("./scraper"); // Import the scraper module
const { writeCsv } = require("./csvWriter"); // Import the CSV writer module
const emailScraper = require("./routes/scraper"); // Import email scraper route
const nodemailer = require("nodemailer"); // Import nodemailer
const gmailSender = require("./routes/gmailSender");

const app = express();
const upload = multer({ dest: "uploads/" });
const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ noServer: true });


app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use((req, res, next) => {
  console.log(`Incoming Request: ${req.method} ${req.url}`);
  next();
});
app.use("/", gmailSender)

const client = new Client();

client.on("qr", async (qr) => {
  const qrCodeImage = await qrcode.toDataURL(qr);
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ qr: qrCodeImage }));
    }
  });
});

client.on("ready", () => console.log("WhatsApp client is ready!"));

client.on("authenticated", () => console.log("WhatsApp client authenticated!"));

client.on("auth_failure", (msg) => console.error("Authentication failed:", msg));

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.use("/", gmailSender)
app.post(
  "/upload",
  upload.fields([
    { name: "messageFile" },
    { name: "contactsFile" },
    { name: "mediaFile" },
  ]),
  async (req, res) => {
    try {
      const messageFile = req.files?.messageFile?.[0];
      const contactsFile = req.files?.contactsFile?.[0];
      const mediaFile = req.files?.mediaFile?.[0];

      if (!messageFile || !contactsFile) {
        return res.status(400).send("Message file and contacts file are required.");
      }

      const message = fs.readFileSync(messageFile.path, "utf-8").trim();
      const workbook = xlsx.readFile(contactsFile.path);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const contacts = xlsx.utils.sheet_to_json(sheet);

      let media = null;
      if (mediaFile) {
        const mediaData = fs.readFileSync(mediaFile.path);
        media = new MessageMedia(
          mediaFile.mimetype,
          mediaData.toString("base64"),
          mediaFile.originalname
        );
      }

      for (let contact of contacts) {
        const phoneNumber = contact["phone"]?.trim();
        if (!phoneNumber) continue;

        console.log("Processing phone number:", phoneNumber);

        const isRegistered = await client.isRegisteredUser(`${phoneNumber}@c.us`);
        if (!isRegistered) {
          console.log(`Number ${phoneNumber} is not registered on WhatsApp.`);
          continue;
        }

        const personalizedMessage = `Hi ${contact["name"] || "there"}, ${message}`;

        try {
          await client.sendMessage(`${phoneNumber}@c.us`, personalizedMessage);
          if (media) {
            await client.sendMessage(`${phoneNumber}@c.us`, media, { caption: personalizedMessage });
          }
          console.log(`Message sent to ${phoneNumber}`);
        } catch (error) {
          console.error(`Failed to send message to ${phoneNumber}:`, error.message);
        }

        await delay(2000); // Delay of 2 seconds
      }

      fs.unlinkSync(messageFile.path);
      fs.unlinkSync(contactsFile.path);
      if (mediaFile) fs.unlinkSync(mediaFile.path);

      res.send("Messages sent successfully!");
    } catch (error) {
      console.error("Error sending messages:", error);
      res.status(500).send(`Error: ${error.message}`);
    }
  }
);

client.initialize();


wss.on("connection", (ws) => {
  console.log("WebSocket connection established");

  const interval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, 30000);

  ws.on("close", () => {
    clearInterval(interval);
    console.log("WebSocket connection closed");
  });
});

// Bulk email sending route
// Update the try-catch in the backend to log full error details:
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
        secure: smtpPort == 465,
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
          console.error(`Failed to send email to ${recipient}:`, err); // Log the error details
          // Send detailed error message back to frontend
          return res.status(500).send(`Failed to send email to ${recipient}: ${err.message}`);
        }
      }

      fs.unlinkSync(recipientsFile.path);
      fs.unlinkSync(htmlTemplateFile.path);

      res.send("Bulk emails sent successfully!");
    } catch (error) {
      console.error("Error sending bulk emails:", error); // Log the error in the backend
      res.status(500).send(`Error: ${error.message}`);
    }
  }
);


// Route to handle search and return results as JSON
app.get("/api/search", async (req, res) => {
  const query = req.query.query;
  let businesses = []; // Default to an empty array

  if (!query) {
    return res.status(400).send({ message: "Query is required" });
  }

  try {
    businesses = await scraper.searchGoogleMaps(query);
    console.log(businesses); // Log the businesses data to verify the format
    await writeCsv(businesses); // Write the CSV file with scraped data
    res.json(businesses); // Return businesses as JSON
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
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});