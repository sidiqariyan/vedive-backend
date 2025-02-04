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

const userSessions = {}; // Store WhatsApp client instances and statuses

// Client status tracking
const clientStatus = {};

const createWhatsAppClient = (userId) => {
  if (userSessions[userId]) return userSessions[userId];

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: userId }),
    puppeteer: { 
      args: ["--no-sandbox", "--disable-setuid-sandbox"], 
      headless: true 
    }
  });

  clientStatus[userId] = {
    ready: false,
    authenticated: false
  };

  client.on("qr", (qr) => {
    if (clientStatus[userId].authenticated) return;
    
    qrcode.toDataURL(qr, (err, url) => {
      wss.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN && ws.userId === userId) {
          ws.send(JSON.stringify({ 
            type: "whatsapp_qr", 
            data: url 
          }));
        }
      });
    });
  });

  client.on("ready", () => {
    console.log(`Client ready for ${userId}`);
    clientStatus[userId] = {
      ready: true,
      authenticated: true
    };
    
    wss.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN && ws.userId === userId) {
        ws.send(JSON.stringify({ 
          type: "whatsapp_ready" 
        }));
      }
    });
  });

  client.on("auth_failure", () => {
    clientStatus[userId].authenticated = false;
  });

  client.on("disconnected", (reason) => {
    console.log(`Client disconnected (${userId}): ${reason}`);
    clientStatus[userId].ready = false;
    delete userSessions[userId];
    createWhatsAppClient(userId);
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

// Middleware to wait for client readiness
const waitForClientReady = (userId) => {
  return new Promise((resolve, reject) => {
    const checkReady = () => {
      if (clientStatus[userId]?.ready) {
        resolve(true);
      } else {
        setTimeout(checkReady, 1000);
      }
    };
    checkReady();
  });
};

app.post("/api/send-whatsapp", async (req, res) => {
  upload(req, res, async (err) => {
    try {
      if (err) {
        if (err instanceof multer.MulterError) {
          return res.status(400).json({ 
            error: "File upload error", 
            details: err.message 
          });
        }
        return res.status(500).json({ 
          error: "Server error", 
          details: err.message 
        });
      }

      const userId = req.body.userId;
      if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
      }

      const client = createWhatsAppClient(userId);
      await waitForClientReady(userId);

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
          return res.status(500).json({ 
            error: "Failed to read message file", 
            details: error.message 
          });
        }
      }

      if (!messageContent.trim()) {
        return res.status(400).json({ error: "Message content is required" });
      }

      const workbook = xlsx.readFile(contactsFile.path);
      const phoneNumbers = xlsx.utils
        .sheet_to_json(workbook.Sheets[workbook.SheetNames[0]])
        .map(row => `${row.Phone}`.replace(/[^+\d]/g, "")) // Keep + and digits
        .filter(num => num.length >= 8 && num.length <= 15)
        .map(num => `${num}@c.us`);

      if (phoneNumbers.length === 0) {
        return res.status(400).json({ error: "No valid phone numbers found" });
      }

      const results = { success: [], failures: [] };
      for (const [index, number] of phoneNumbers.entries()) {
        try {
          if (!clientStatus[userId].ready) {
            throw new Error("WhatsApp client disconnected");
          }

          await client.sendMessage(number, messageContent);
          results.success.push(number);
          
          // Randomized delay between 5-10 seconds
          const delay = 5000 + Math.random() * 5000;
          if (index < phoneNumbers.length - 1) {
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        } catch (error) {
          results.failures.push({ 
            number, 
            error: error.message 
          });
        }
      }

      res.json({ 
        success: results.failures.length === 0,
        sent: results.success.length,
        failed: results.failures 
      });
    } catch (error) {
      console.error("Error in send route:", error);
      res.status(500).json({ 
        error: "Internal server error", 
        details: error.message 
      });
    } finally {
      // Clean up uploaded files
      if (req.files) {
        Object.values(req.files).forEach(files => {
          files.forEach(file => {
            try {
              fs.unlinkSync(file.path);
            } catch (err) {
              console.error("Error deleting file:", err);
            }
          });
        });
      }
    }
  });
});

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const userId = url.searchParams.get("userId");
  
  if (!userId) {
    ws.close(1008, "User ID required");
    return;
  }
  
  ws.userId = userId;
  console.log(`WS connected: ${userId}`);

  // Send current status if available
  if (clientStatus[userId]?.ready) {
    ws.send(JSON.stringify({ type: "whatsapp_ready" }));
  }

  ws.on("close", () => {
    console.log(`WS disconnected: ${userId}`);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
