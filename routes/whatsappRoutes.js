const express = require('express');
const multer = require('multer');
const { Client } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { authenticate } = require("../middleware/authMiddleware"); // Import the authenticate middleware
const router = express.Router();

// Debugging log
console.log("Authenticate Middleware:", authenticate);

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
const upload = multer({ storage: storage });

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
router.get('/qr', authenticate, (req, res) => {
  const userId = req.user.email; // Use email as userId
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
router.post('/send', authenticate, upload.single('media'), async (req, res) => {
  const userId = req.user.email; // Use email as userId
  const { users, message } = req.body;
  const mediaFile = req.file;
  if (!usersDb[userId] || !usersDb[userId].isAuthenticated) {
    return res.status(400).json({ error: 'User is not authenticated.' });
  }
  if (!users || !message) {
    return res.status(400).json({ error: 'Please provide both users and message.' });
  }
  const userArray = users.split('\n').map(user => user.trim()).filter(user => user);
  const client = usersDb[userId].client;
  try {
    for (const user of userArray) {
      const phoneNumber = user.replace(/\D/g, ''); // Remove non-numeric characters
      const chatId = `${phoneNumber}@c.us`;
      if (mediaFile) {
        const mediaPath = mediaFile.path;
        const media = await client.sendMessage(chatId, mediaPath);
        await client.sendMessage(chatId, message);
      } else {
        await client.sendMessage(chatId, message);
      }
    }
    res.json({ message: 'Messages sent successfully!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error sending messages.' });
  }
});

module.exports = router;