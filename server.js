const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
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
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/", gmailSender);

const client = new Client({ authStrategy: new LocalAuth() });

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

app.post("/upload", upload.fields([{ name: "messageFile" }, { name: "contactsFile" }, { name: "mediaFile" }]), (req, res) => {
  res.json({ message: "Files uploaded successfully!" });
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
