const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");
const WebSocket = require("ws");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const http = require("http");

const app = express();
const PORT = process.env.PORT || 3001;
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const clients = new Map(); // Store multiple user sessions

const createClient = (userId) => {
  if (clients.has(userId)) return clients.get(userId);

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: userId }),
    puppeteer: { args: ["--no-sandbox", "--disable-setuid-sandbox"], headless: true },
  });

  client.on("qr", (qr) => {
    qrcode.toDataURL(qr, (err, url) => {
      wss.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "whatsapp_qr", userId, data: url }));
        }
      });
    });
  });

  client.on("ready", () => console.log(`WhatsApp Client ready for user ${userId}`));
  client.initialize();
  clients.set(userId, client);
  return client;
};

const storage = multer.diskStorage({
  destination: "./uploads/",
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage }).fields([{ name: "contactsFile", maxCount: 1 }]);

app.post("/api/connect", (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "User ID is required" });
  createClient(userId);
  res.json({ success: true, message: "Client initialized, scan the QR code." });
});

app.post("/api/send-whatsapp", (req, res) => {
  upload(req, res, async (err) => {
    if (err) return res.status(500).json({ error: "File upload error", details: err.message });
    
    const { userId, message } = req.body;
    const contactsFile = req.files?.contactsFile?.[0];
    if (!userId || !contactsFile || !message) return res.status(400).json({ error: "Missing required fields" });
    
    const client = clients.get(userId);
    if (!client) return res.status(400).json({ error: "Client not connected" });
    
    try {
      const workbook = xlsx.readFile(contactsFile.path);
      const phoneNumbers = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]])
        .map(row => `${row.Phone}`.replace(/\D/g, ""))
        .filter(Boolean)
        .map(num => `${num}@c.us`);
      
      const results = { success: [], failures: [] };
      for (const [index, number] of phoneNumbers.entries()) {
        try {
          await client.sendMessage(number, message);
          results.success.push(number);
          console.log(`Sent to ${number} (${index + 1}/${phoneNumbers.length})`);
          if (index < phoneNumbers.length - 1) await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          results.failures.push({ number, error: error.message });
        }
      }
      res.json({ success: results.failures.length === 0, sent: results.success.length, failed: results.failures });
    } catch (error) {
      res.status(500).json({ error: "Error sending messages", details: error.message });
    }
  });
});

server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

wss.on("connection", (ws) => {
  console.log("WebSocket client connected");
  ws.on("close", () => console.log("WebSocket client disconnected"));
  ws.on("error", (err) => console.error("WebSocket error:", err));
});
