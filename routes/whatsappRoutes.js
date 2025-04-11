require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { authenticate } = require("../middleware/authMiddleware");
const { Client } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const multer = require("multer");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const Campaign = require("../models/Campaign");

const router = express.Router();

// Enable CORS
router.use(cors());

// Ensure uploads directory exists
const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}

// Multer configuration for media uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    // Fixed: originalname instead of originalName
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "application/pdf"];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error("Invalid file type. Only JPEG, PNG, and PDF are allowed."));
    }
    cb(null, true);
  },
});

// WhatsApp clients storage (per user)
const usersDb = {};

// Helper function to initialize a WhatsApp client for a user
function initializeClient(userId) {
  const client = new Client({
    puppeteer: {
      headless: true,
      // Use custom executablePath if provided, otherwise fallback to bundled Chromium
      executablePath: process.env.CHROME_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process'
      ]
    },
    session: usersDb[userId]?.session || null,
  });

  client.on("qr", async (qr) => {
    console.log(`QR RECEIVED for user ${userId}`);
    try {
      usersDb[userId].qrCodeData = await QRCode.toDataURL(qr);
    } catch (err) {
      console.error("Error generating QR code:", err);
    }
  });

  client.on("ready", () => {
    console.log(`Client is ready for user ${userId}!`);
    usersDb[userId].isAuthenticated = true;
    usersDb[userId].qrCodeData = "";
    // Save session details if needed
    usersDb[userId].session = client.session;
  });

  client.on("disconnected", () => {
    console.log(`Client disconnected for user ${userId}`);
    delete usersDb[userId];
  });

  // Additional error logging to capture any Puppeteer/browser issues
  client.on("error", (error) => {
    console.error(`Client error for user ${userId}:`, error);
  });

  try {
    client.initialize();
  } catch (initError) {
    console.error(`Failed to initialize client for user ${userId}:`, initError);
  }
  return client;
}

// Route to get QR code for a specific user
router.get("/qr", authenticate, async (req, res) => {
  const userId = req.user._id.toString(); // Use authenticated user's ID

  if (!usersDb[userId]) {
    usersDb[userId] = {
      userId,
      client: initializeClient(userId),
      qrCodeData: "",
      isAuthenticated: false,
    };
  }

  const user = usersDb[userId];
  if (user.qrCodeData) {
    res.json({ qrCode: user.qrCodeData });
  } else if (user.isAuthenticated) {
    res.json({ qrCode: null, message: "WhatsApp is authenticated!" });
  } else {
    res.status(400).json({ error: "QR code not available yet" });
  }
});

// Route to send messages with campaign feature
router.post("/send", authenticate, upload.single("media"), async (req, res) => {
  const userId = req.user._id.toString(); // Use authenticated user's ID
  const { users, message, campaignName } = req.body;
  const mediaFile = req.file;

  if (!users || !message || !campaignName) {
    return res.status(400).json({ error: "Please provide users, message, and campaign name" });
  }

  if (!usersDb[userId] || !usersDb[userId].isAuthenticated) {
    return res.status(400).json({ error: "User is not authenticated with WhatsApp" });
  }

  const userArray = users.split("\n").map((user) => user.trim()).filter((user) => user);
  const invalidUsers = [];
  const validPhoneNumbers = [];

  for (const user of userArray) {
    const phoneNumber = parsePhoneNumberFromString(user, process.env.DEFAULT_COUNTRY_CODE || "IN");
    if (!phoneNumber || !phoneNumber.isValid()) {
      invalidUsers.push(user);
    } else {
      validPhoneNumbers.push(phoneNumber.number.replace(/\D/g, ""));
    }
  }

  if (invalidUsers.length > 0) {
    return res.status(400).json({ error: `Invalid phone numbers: ${invalidUsers.join(", ")}` });
  }

  const client = usersDb[userId].client;

  try {
    const sentMessages = [];
    for (const phoneNumber of validPhoneNumbers) {
      const chatId = `${phoneNumber}@c.us`;
      if (mediaFile) {
        const mediaPath = mediaFile.path;
        await client.sendMessage(chatId, fs.readFileSync(mediaPath), { media: true });
        await client.sendMessage(chatId, message);
      } else {
        await client.sendMessage(chatId, message);
      }
      console.log(`Message sent to ${phoneNumber}:`, message);
      sentMessages.push(phoneNumber);
    }

    if (mediaFile) {
      fs.unlinkSync(mediaFile.path);
    }

    // Save campaign (no fromEmail since it's optional in the updated schema)
    const newCampaign = new Campaign({
      userId,
      campaignName,
      toolType: "whatsapp-bulk-sender",
      messageContent: message,
      recipients: sentMessages,
      status: "completed",
    });
    await newCampaign.save();

    res.status(200).json({
      message: "Messages sent successfully",
      campaignId: newCampaign._id,
      sentMessages,
    });
  } catch (error) {
    console.error("Error in /whatsapp/send:", error.stack);
    res.status(500).json({ error: "Error sending messages", details: error.message });
  }
});

module.exports = router;
