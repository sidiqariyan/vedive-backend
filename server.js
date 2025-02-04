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

// Ensure the uploads folder exists
if (!fs.existsSync("./uploads")) {
  fs.mkdirSync("./uploads");
}

const userSessions = {}; // Store WhatsApp client instances per user

// Function to create a new WhatsApp client for a user
const createWhatsAppClient = (userId) => {
  if (userSessions[userId]) return userSessions[userId];

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: userId }),
    puppeteer: { args: ["--no-sandbox", "--disable-setuid-sandbox"], headless: true }
  });

  client.on("qr", (qr) => {
    qrcode.toDataURL(qr, (err, url) => {
      wss.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN && ws.userId === userId) {
          ws.send(JSON.stringify({ type: "whatsapp_qr", data: url }));
        }
      });
    });
  });

  client.on("ready", () => {
    console.log(`WhatsApp Client ready for user ${userId}`);
  });

  client.on("disconnected", (reason) => {
    console.log(`WhatsApp Client disconnected for user ${userId}. Reason: ${reason}`);
    delete userSessions[userId]; // Clean up the session
    createWhatsAppClient(userId); // Re-initialize the client
  });

  client.initialize();
  userSessions[userId] = client;
  return client;
};

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
    if (err) return res.status(500).json({ error: "File upload error", details: err.message });

    const userId = req.body.userId;
    if (!userId) return res.status(400).json({ error: "User ID is required" });
    
    const client = createWhatsAppClient(userId);
    const contactsFile = req.files?.contactsFile?.[0];
    const messageFile = req.files?.messageFile?.[0];

    if (!contactsFile) return res.status(400).json({ error: "Contacts file is required" });
    
    let messageContent = req.body.message || "";
    if (messageFile) {
      try {
        messageContent = fs.readFileSync(messageFile.path, "utf8");
      } catch (error) {
        return res.status(500).json({ error: "Failed to read message file", details: error.message });
      }
    }
    if (!messageContent.trim()) return res.status(400).json({ error: "Message content is required" });
    
    try {
      const workbook = xlsx.readFile(contactsFile.path);
      const phoneNumbers = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]])
        .map(row => `${row.Phone}`.replace(/\D/g, ""))
        .filter(Boolean)
        .map(num => `${num}@c.us`);

      if (phoneNumbers.length === 0) return res.status(400).json({ error: "No valid phone numbers found" });

      const results = { success: [], failures: [] };
      for (const [index, number] of phoneNumbers.entries()) {
        try {
          await client.sendMessage(number, messageContent);
          results.success.push(number);
          console.log(`Sent to ${number} (${index + 1}/${phoneNumbers.length})`);
          if (index < phoneNumbers.length - 1) await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          results.failures.push({ number, error: error.message });
        }
      }
      res.json({ success: results.failures.length === 0, sent: results.success.length, failed: results.failures });
    } catch (error) {
      res.status(500).json({ error: "Internal server error", details: error.message });
    }
  });
});

wss.on("connection", (ws, req) => {
  const userId = new URL(req.url, `http://localhost:${PORT}`).searchParams.get("userId");
  if (!userId) {
    ws.close(1000, "User ID is required");
    return;
  }
  ws.userId = userId;
  console.log(`WebSocket client connected for user ${userId}`);

  ws.on("close", () => console.log(`WebSocket client disconnected for user ${userId}`));
  ws.on("error", (err) => console.error("WebSocket error:", err));
});

server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
