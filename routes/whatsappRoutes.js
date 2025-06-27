require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { authenticate } = require("../middleware/authMiddleware");
const { 
  Campaign, 
  WhatsAppAnalytics, 
  CampaignAnalytics,
  WhatsAppAccount
} = require("../models/Whatsapp-Campaign");

const WhatsAppService = require("../services/whatsappService");
const AnalyticsService = require("../services/analyticsService");
const { storage } = require("../config/multerConfig");

const router = express.Router();
router.use(cors());

const upload = multer({ storage });
const whatsappService = new WhatsAppService();
const analyticsService = new AnalyticsService();

// Route to get QR code
router.get("/qr", authenticate, async (req, res) => {
  const userId = req.user._id.toString();

  try {
    const result = await whatsappService.getQRCode(userId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Error generating QR code" });
  }
});

// Route to disconnect a WhatsApp account
router.post("/disconnect-account", authenticate, async (req, res) => {
  const userId = req.user._id.toString();
  const { phoneNumber } = req.body;

  try {
    const result = await whatsappService.disconnectAccount(userId, phoneNumber);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Error disconnecting account" });
  }
});

// Route to switch to a specific WhatsApp account
router.post("/switch-account", authenticate, async (req, res) => {
  const userId = req.user._id.toString();
  const { phoneNumber } = req.body;

  try {
    const result = await whatsappService.switchAccount(userId, phoneNumber);
    
    if (result.needsReauth) {
      return res.status(400).json(result);
    }
    
    if (result.pending) {
      setTimeout(async () => {
        const finalResult = await whatsappService.checkAccountStatus(userId, phoneNumber);
        // Note: This is a simplified approach. In production, consider using WebSockets
      }, 5000);
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Error switching account" });
  }
});

// Enhanced send route
router.post("/send", authenticate, upload.single("media"), async (req, res) => {
  const userId = req.user._id.toString();
  const { users, message, campaignName } = req.body;
  const mediaFile = req.file;

  try {
    const result = await whatsappService.sendBulkMessages({
      userId,
      users,
      message,
      campaignName,
      mediaFile
    });

    res.status(200).json(result);
  } catch (error) {
    if (mediaFile && fs.existsSync(mediaFile.path)) {
      fs.unlinkSync(mediaFile.path);
    }
    
    res.status(500).json({ 
      success: false,
      error: "Error sending messages", 
      details: error.message 
    });
  }
});

// Analytics route
router.get("/analytics", authenticate, async (req, res) => {
  const userId = req.user._id.toString();
  const { phoneNumber } = req.query;

  try {
    const analytics = await analyticsService.getCampaignAnalytics(userId, phoneNumber);
    res.json(analytics);
  } catch (error) {
    res.status(500).json({ error: "Error fetching analytics" });
  }
});

// Route to get account-specific analytics
router.get("/analytics/account/:phoneNumber", authenticate, async (req, res) => {
  const userId = req.user._id.toString();
  const { phoneNumber } = req.params;

  try {
    const analytics = await analyticsService.getAccountAnalytics(userId, phoneNumber);
    res.json(analytics);
  } catch (error) {
    res.status(500).json({ error: "Error fetching account analytics" });
  }
});

// Cleanup on server shutdown
process.on('SIGINT', () => {
  whatsappService.cleanup();
  process.exit(0);
});

module.exports = router;