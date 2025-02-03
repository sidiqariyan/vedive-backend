const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");
const WebSocket = require("ws");
const https = require("https");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");

// Load SSL certificates
const privateKey = fs.readFileSync("/etc/letsencrypt/live/YOUR_DOMAIN/privkey.pem", "utf8");
const certificate = fs.readFileSync("/etc/letsencrypt/live/YOUR_DOMAIN/fullchain.pem", "utf8");
const credentials = { key: privateKey, cert: certificate };

const app = express();
const PORT = process.env.PORT || 3001;

// Create HTTPS server
const server = https.createServer(credentials, app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { 
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: true
  }
});

client.on("qr", (qr) => {
  qrcode.toDataURL(qr, (err, url) => {
    wss.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "whatsapp_qr", data: url }));
      }
    });
  });
});

client.on("ready", () => {
  console.log("WhatsApp Client ready");
});

client.initialize();

const storage = multer.diskStorage({
  destination: "./uploads/",
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }
}).fields([{ name: "contactsFile", maxCount: 1 }, { name: "messageFile", maxCount: 1 }]);

app.post("/api/send-whatsapp", (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      console.error("Multer error:", err);
      return res.status(500).json({ error: "File upload error", details: err.message });
    }
    
    console.log("Received request:", req.method, req.url);
    console.log("Body:", req.body);
    console.log("Files:", req.files);

    const contactsFile = req.files?.contactsFile?.[0];
    const messageFile = req.files?.messageFile?.[0];
    
    if (!contactsFile) {
      return res.status(400).json({ error: "Contacts file is required" });
    }
    
    let messageContent = req.body.message || "";
    if (messageFile) {
      try {
        messageContent = fs.readFileSync(messageFile.path, "utf8");
      } catch (error) {
        return res.status(500).json({ error: "Failed to read message file", details: error.message });
      }
    }
    
    if (!messageContent.trim()) {
      return res.status(400).json({ error: "Message content is required" });
    }
    
    try {
      const workbook = xlsx.readFile(contactsFile.path);
      const phoneNumbers = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]])
        .map(row => `${row.Phone}`.replace(/\D/g, ""))
        .filter(Boolean)
        .map(num => `${num}@c.us`);
      
      if (phoneNumbers.length === 0) {
        return res.status(400).json({ error: "No valid phone numbers found" });
      }

      const results = { success: [], failures: [] };
      for (const [index, number] of phoneNumbers.entries()) {
        try {
          await client.sendMessage(number, messageContent);
          results.success.push(number);
          console.log(`Sent to ${number} (${index + 1}/${phoneNumbers.length})`);
          if (index < phoneNumbers.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } catch (error) {
          results.failures.push({ number, error: error.message });
        }
      }
      res.json({ success: results.failures.length === 0, sent: results.success.length, failed: results.failures });
    } catch (error) {
      console.error("WhatsApp send error:", error);
      res.status(500).json({ error: "Internal server error", details: error.message });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Secure server running on port ${PORT}`);
});

wss.on("connection", (ws) => {
  console.log("WebSocket client connected");
  
  ws.on("close", () => {
    console.log("WebSocket client disconnected");
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
  });
});
