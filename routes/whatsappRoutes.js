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

// Route to get QR code or restore existing sessions
router.get("/qr", authenticate, async (req, res) => {
  const userId = req.user._id.toString();

  try {
    const result = await whatsappService.getQRCode(userId);
    res.json(result);
  } catch (error) {
    console.error('QR endpoint error:', error);
    res.status(500).json({ error: "Error generating QR code" });
  }
});

// Route to get user's WhatsApp accounts
router.get("/accounts", authenticate, async (req, res) => {
  const userId = req.user._id.toString();

  try {
    const accounts = await whatsappService.getUserWhatsAppAccounts(userId);
    res.json({ accounts });
  } catch (error) {
    console.error('Accounts endpoint error:', error);
    res.status(500).json({ error: "Error fetching accounts" });
  }
});

// Route to get general WhatsApp service status
router.get("/status", authenticate, async (req, res) => {
  const userId = req.user._id.toString();

  try {
    // Get all user accounts and their status
    const accounts = await whatsappService.getUserWhatsAppAccounts(userId);
    const accountStatuses = [];

    for (const account of accounts) {
      const status = await whatsappService.checkAccountStatus(userId, account.phoneNumber);
      accountStatuses.push({
        phoneNumber: account.phoneNumber,
        ...status
      });
    }

    res.json({
      success: true,
      accounts: accountStatuses,
      totalAccounts: accounts.length,
      connectedAccounts: accountStatuses.filter(acc => acc.isAuthenticated).length
    });
  } catch (error) {
    console.error('Status endpoint error:', error);
    res.status(500).json({ 
      success: false,
      error: "Error fetching WhatsApp status",
      message: error.message 
    });
  }
});

// Route to restore all sessions for a user
router.post("/restore-sessions", authenticate, async (req, res) => {
  const userId = req.user._id.toString();

  try {
    const result = await whatsappService.restoreAllUserSessions(userId);
    res.json(result);
  } catch (error) {
    console.error('Restore sessions error:', error);
    res.status(500).json({ error: "Error restoring sessions" });
  }
});

// Route to disconnect a WhatsApp account
router.post("/disconnect-account", authenticate, async (req, res) => {
  const userId = req.user._id.toString();
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({ error: "Phone number is required" });
  }

  try {
    const result = await whatsappService.disconnectAccount(userId, phoneNumber);
    res.json(result);
  } catch (error) {
    console.error('Disconnect account error:', error);
    res.status(500).json({ error: "Error disconnecting account" });
  }
});

// Route to switch to a specific WhatsApp account
router.post("/switch-account", authenticate, async (req, res) => {
  const userId = req.user._id.toString();
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({ error: "Phone number is required" });
  }

  try {
    const result = await whatsappService.switchAccount(userId, phoneNumber);
    
    if (result.needsReauth) {
      return res.status(400).json(result);
    }
    
    if (result.pending) {
      // Use a timeout to check connection status
      setTimeout(async () => {
        try {
          const finalResult = await whatsappService.checkAccountStatus(userId, phoneNumber);
          // In production, consider using WebSockets or Server-Sent Events
          // for real-time updates instead of setTimeout
        } catch (error) {
          console.error('Status check error:', error);
        }
      }, 10000); // Wait 10 seconds for connection
    }
    
    res.json(result);
  } catch (error) {
    console.error('Switch account error:', error);
    res.status(500).json({ error: "Error switching account" });
  }
});

// Route to check account connection status
router.get("/account-status/:phoneNumber", authenticate, async (req, res) => {
  const userId = req.user._id.toString();
  const { phoneNumber } = req.params;

  try {
    const result = await whatsappService.checkAccountStatus(userId, phoneNumber);
    res.json(result);
  } catch (error) {
    console.error('Account status error:', error);
    res.status(500).json({ error: "Error checking account status" });
  }
});

// Enhanced send route
router.post("/send", authenticate, upload.single("media"), async (req, res) => {
  const userId = req.user._id.toString();
  const { users, message, campaignName } = req.body;
  const mediaFile = req.file;

  // Validation
  if (!users || !message) {
    if (mediaFile && fs.existsSync(mediaFile.path)) {
      fs.unlinkSync(mediaFile.path);
    }
    return res.status(400).json({ 
      success: false,
      error: "Users and message are required" 
    });
  }

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
    console.error('Send messages error:', error);
    
    // Cleanup media file on error
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

// Route to check specific account status (alternative endpoint)
router.get('/check-status/:phoneNumber', authenticate, async (req, res) => {
  const userId = req.user._id.toString();
  const { phoneNumber } = req.params;
  
  try {
    const result = await whatsappService.checkAccountStatus(userId, phoneNumber);
    res.json({
      success: true,
      isAuthenticated: result.isAuthenticated || false,
      needsReauth: result.needsReauth || false,
      status: result.status || 'unknown',
      phoneNumber: phoneNumber
    });
  } catch (error) {
    console.error('Check status error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to check account status',
      message: error.message 
    });
  }
});

// Cleanup on server shutdown
process.on('SIGINT', () => {
  whatsappService.cleanup();
  process.exit(0);
});

module.exports = router;