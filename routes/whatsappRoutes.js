const express = require('express');
const multer = require('multer');
const { Client } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { parsePhoneNumberFromString } = require('libphonenumber-js');
const cors = require('cors'); // Add CORS middleware
const Campaign = require("../models/Campaign");
const router = express.Router();

// Enable CORS
router.use(cors());

// Ensure uploads directory exists
const dir = './uploads';
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir);
}

// Database simulation (replace with actual database)
const usersDb = {}; // { userId: { client, qrCodeData, isAuthenticated } }

// Multer configuration for media uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // Limit file size to 10 MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Only JPEG, PNG, and PDF are allowed.'));
    }
    cb(null, true);
  }
});

// Helper function to initialize a WhatsApp client for a user
function initializeClient(userId) {
  const client = new Client({
    puppeteer: { headless: true },
    session: usersDb[userId]?.session || null, // Restore session if available
  });

  client.on('qr', async (qr) => {
    console.log(`QR RECEIVED for user ${userId}`);
    usersDb[userId].qrCodeData = await QRCode.toDataURL(qr); // Convert QR code to base64 image
  });

  client.on('ready', () => {
    console.log(`Client is ready for user ${userId}!`);
    usersDb[userId].isAuthenticated = true;
    usersDb[userId].qrCodeData = ''; // Clear QR code once authenticated
    usersDb[userId].session = client.getSession(); // Save session for future use
  });

  client.on('disconnected', () => {
    console.log(`Client disconnected for user ${userId}`);
    delete usersDb[userId]; // Remove user from the database
  });

  client.initialize();
  return client;
}

// Route to get QR code for a specific user
router.get('/qr', (req, res) => {
  const userId = "defaultUser"; // Use a default user ID since there's no authentication

  if (!usersDb[userId]) {
    usersDb[userId] = { client: initializeClient(userId), qrCodeData: '', isAuthenticated: false };
  }

  const user = usersDb[userId];

  if (user.qrCodeData) {
    res.json({ qrCode: user.qrCodeData });
  } else if (user.isAuthenticated) {
    res.json({ qrCode: null, message: 'WhatsApp is authenticated!' });
  } else {
    res.status(400).json({ error: 'QR code not available yet.' });
  }
});

// Route to send messages
router.post('/send', upload.single('media'), async (req, res) => {
  const userId = "defaultUser"; // Use a default user ID since there's no authentication
  const { users, message, campaignName } = req.body; // Add campaignName to the request body
  const mediaFile = req.file;

  // Validate required fields
  if (!users || !message || !campaignName) {
    return res.status(400).json({ error: 'Please provide users, message, and campaign name.' });
  }

  if (!usersDb[userId] || !usersDb[userId].isAuthenticated) {
    return res.status(400).json({ error: 'User is not authenticated.' });
  }

  const userArray = users.split('\n').map(user => user.trim()).filter(user => user);

  // Validate phone numbers
  const invalidUsers = [];
  for (const user of userArray) {
    const phoneNumber = parsePhoneNumberFromString(user, 'IN'); // Validate phone number (replace 'IN' with the country code)
    if (!phoneNumber || !phoneNumber.isValid()) {
      invalidUsers.push(user);
    }
  }

  if (invalidUsers.length > 0) {
    return res.status(400).json({ error: `Invalid phone numbers: ${invalidUsers.join(', ')}` });
  }

  const client = usersDb[userId].client;

  try {
    const sentMessages = [];

    for (const user of userArray) {
      const phoneNumber = user.replace(/\D/g, ''); // Remove non-numeric characters
      const chatId = `${phoneNumber}@c.us`;

      if (mediaFile) {
        const mediaPath = mediaFile.path;
        await client.sendMessage(chatId, mediaPath);
        await client.sendMessage(chatId, message);
      } else {
        await client.sendMessage(chatId, message);
      }

      sentMessages.push(phoneNumber);
    }

    // Save campaign data to MongoDB
    const newCampaign = new Campaign({
      campaignName,
      toolType: "whatsapp-bulk-sender", // Static name for the WhatsApp Bulk Sender tool
      messageContent: message,
      recipients: sentMessages,
    });

    await newCampaign.save();

    res.json({ message: 'Messages sent successfully!', sentMessages });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error sending messages.' });
  }
});

module.exports = router;