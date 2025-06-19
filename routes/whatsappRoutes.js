require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { authenticate } = require("../middleware/authMiddleware");
const { Client, MessageMedia } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const multer = require("multer");
const { parsePhoneNumberFromString } = require("libphonenumber-js");

const { 
  Campaign, 
  WhatsAppAnalytics, 
  CampaignAnalytics,
  WhatsAppAccount
} = require("../models/Whatsapp-Campaign");

const router = express.Router();
router.use(cors());

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

// User database with phone number tracking
const usersDb = {};

// Helper function to get user's WhatsApp accounts
async function getUserWhatsAppAccounts(userId) {
  try {
    const accounts = await WhatsAppAccount.find({ userId, isActive: true });
    return accounts.map(acc => ({
      phoneNumber: acc.phoneNumber,
      isAuthenticated: acc.isAuthenticated,
      lastConnected: acc.lastConnected,
      campaignCount: acc.campaignCount || 0
    }));
  } catch (error) {
    console.error("Error fetching user WhatsApp accounts:", error);
    return [];
  }
}

// Clean up function to prevent memory leaks
function cleanupUserSession(userId) {
  if (usersDb[userId]) {
    Object.values(usersDb[userId].accounts).forEach(account => {
      if (account.client) {
        try {
          account.client.destroy();
        } catch (error) {
          console.error("Error destroying client:", error);
        }
      }
    });
    delete usersDb[userId];
  }
}

// Check pending message statuses after reconnection
async function checkPendingMessageStatuses(client, phoneNumber, userId) {
  try {
    const threeDaysAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);
    const pendingMessages = await WhatsAppAnalytics.find({
      senderPhoneNumber: phoneNumber,
      userId,
      sentAt: { $gte: threeDaysAgo },
      status: { $in: ['sent', 'delivered', 'pending'] },
      messageId: { $exists: true, $ne: null }
    }).limit(100);

    if (pendingMessages.length === 0) return;

    for (const analytics of pendingMessages) {
      try {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const phoneMatch = analytics.messageId.match(/(\d{10,15})/);
        if (!phoneMatch) continue;
        
        const recipientPhone = phoneMatch[1];
        const chatId = `${recipientPhone}@c.us`;
        
        const chat = await client.getChatById(chatId).catch(() => null);
        if (!chat) continue;

        const messages = await chat.fetchMessages({ 
          limit: 10,
          fromMe: true 
        }).catch(() => []);
        
        const message = messages.find(m => m.id._serialized === analytics.messageId);
        if (!message) continue;

        let currentStatus = 'sent';
        if (message.ack === 3) currentStatus = 'read';
        else if (message.ack === 2) currentStatus = 'delivered';
        else if (message.ack === 1) currentStatus = 'sent';

        if (currentStatus !== analytics.status) {
          analytics.status = currentStatus;
          if (currentStatus === 'delivered' && !analytics.deliveredAt) {
            analytics.deliveredAt = new Date();
          }
          if (currentStatus === 'read' && !analytics.readAt) {
            analytics.readAt = new Date();
          }
          await analytics.save();
        }
        
      } catch (messageError) {
        continue;
      }
    }
    
  } catch (error) {
    console.error("Error in checkPendingMessageStatuses:", error.message);
  }
}

// Update message analytics
async function updateMessageAnalytics(messageId, status, phoneNumber, userId) {
  try {
    const phoneMatch = messageId.match(/(\d{10,15})/);
    if (!phoneMatch) return;
    
    const extractedPhone = phoneMatch[1];
    let analytics = await findAnalyticsRecord(messageId, extractedPhone, phoneNumber, userId);
    
    if (analytics) {
      const oldStatus = analytics.status;
      const shouldUpdate = (
        (oldStatus === 'pending' && status !== 'pending') ||
        (oldStatus === 'sent' && (status === 'delivered' || status === 'read')) ||
        (oldStatus === 'delivered' && status === 'read')
      );
      
      if (shouldUpdate) {
        analytics.status = status;
        analytics.messageId = messageId;
        
        if (status === "delivered" && oldStatus !== "delivered") {
          analytics.deliveredAt = new Date();
        }
        if (status === "read" && oldStatus !== "read") {
          analytics.readAt = new Date();
        }
        
        await analytics.save();
        updateCampaignAnalyticsBackground(analytics.campaignId);
      }
    }
  } catch (error) {
    console.error("Error updating message analytics:", error.message);
  }
}

// Find analytics record with multiple strategies
async function findAnalyticsRecord(messageId, extractedPhone, phoneNumber, userId) {
  // Try exact message ID match first
  let analytics = await WhatsAppAnalytics.findOne({ 
    messageId,
    senderPhoneNumber: phoneNumber,
    userId
  });
  
  if (analytics) return analytics;
  
  // Try by phone number and recent timestamp
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  analytics = await WhatsAppAnalytics.findOne({
    phoneNumber: extractedPhone,
    senderPhoneNumber: phoneNumber,
    userId,
    sentAt: { $gte: fiveMinutesAgo },
    status: { $in: ['sent', 'delivered', 'pending'] }
  }).sort({ sentAt: -1 });
  
  if (analytics) {
    if (analytics.messageId !== messageId) {
      analytics.messageId = messageId;
    }
    return analytics;
  }
  
  // Try most recent record for this phone
  analytics = await WhatsAppAnalytics.findOne({
    phoneNumber: extractedPhone,
    senderPhoneNumber: phoneNumber,
    userId,
    status: { $in: ['sent', 'delivered', 'pending'] }
  }).sort({ sentAt: -1 });
  
  if (analytics) {
    if (analytics.messageId !== messageId) {
      analytics.messageId = messageId;
    }
    return analytics;
  }
  
  return null;
}

// Background campaign analytics update
function updateCampaignAnalyticsBackground(campaignId) {
  setImmediate(async () => {
    try {
      const campaignAnalytics = await CampaignAnalytics.findOne({ campaignId });
      if (campaignAnalytics) {
        await campaignAnalytics.updateAnalytics();
      }
    } catch (campaignError) {
      console.error("Campaign analytics update failed:", campaignError.message);
    }
  });
}

// Enhanced message acknowledgment handler
function setupMessageAckHandler(client, phoneNumber, userId) {
  client.on("message_ack", async (msg, ack) => {
    try {
      const messageId = msg.id._serialized;
      let status = "sent";
      
      switch (ack) {
        case 1: status = "sent"; break;
        case 2: status = "delivered"; break;
        case 3: status = "read"; break;
        default: return;
      }

      await updateMessageAnalytics(messageId, status, phoneNumber, userId);
      
    } catch (error) {
      console.error("Error in message_ack handler:", error.message);
    }
  });
}

// Initialize client for specific phone number
function initializeClientForPhone(userId, sessionId = null) {
  const client = new Client({
    puppeteer: {
      headless: true,
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
    session: sessionId || null,
  });

  let detectedPhoneNumber = null;

  client.on("qr", async (qr) => {
    if (!usersDb[userId]) {
      usersDb[userId] = { accounts: {}, currentAuth: null };
    }
    try {
      usersDb[userId].qrCodeData = await QRCode.toDataURL(qr);
    } catch (error) {
      console.error("Error generating QR code:", error);
    }
  });

  client.on("ready", async () => {
    try {
      const info = client.info;
      detectedPhoneNumber = info.wid.user;
      
      if (!usersDb[userId]) {
        usersDb[userId] = { accounts: {}, currentAuth: null };
      }
      
      usersDb[userId].accounts[detectedPhoneNumber] = {
        client: client,
        isAuthenticated: true,
        phoneNumber: detectedPhoneNumber,
        authenticatedAt: new Date(),
        qrCodeData: ""
      };
      
      usersDb[userId].currentAuth = detectedPhoneNumber;
      usersDb[userId].qrCodeData = "";

      await WhatsAppAccount.findOneAndUpdate(
        { userId, phoneNumber: detectedPhoneNumber },
        {
          userId,
          phoneNumber: detectedPhoneNumber,
          isAuthenticated: true,
          isActive: true,
          lastConnected: new Date(),
          sessionData: JSON.stringify(client.session || {})
        },
        { upsert: true, new: true }
      );

      setupMessageAckHandler(client, detectedPhoneNumber, userId);
      
      // Check pending messages after reconnection
      setTimeout(() => {
        checkPendingMessageStatuses(client, detectedPhoneNumber, userId);
      }, 5000);
      
    } catch (error) {
      console.error("Error in ready event:", error);
    }
  });

  client.on("disconnected", async () => {
    if (detectedPhoneNumber && usersDb[userId]?.accounts[detectedPhoneNumber]) {
      usersDb[userId].accounts[detectedPhoneNumber].isAuthenticated = false;
      
      try {
        await WhatsAppAccount.findOneAndUpdate(
          { userId, phoneNumber: detectedPhoneNumber },
          {
            isAuthenticated: false,
            lastDisconnected: new Date()
          }
        );
      } catch (error) {
        console.error("Error updating disconnection status:", error);
      }
    }
  });

  client.on("auth_failure", (msg) => {
    console.error(`Authentication failed for user ${userId}:`, msg);
    if (usersDb[userId]) {
      usersDb[userId].authFailed = true;
    }
  });

  client.initialize();
  return client;
}

// Route to get QR code
router.get("/qr", authenticate, async (req, res) => {
  const userId = req.user._id.toString();

  try {
    if (!usersDb[userId]) {
      usersDb[userId] = { 
        accounts: {}, 
        currentAuth: null,
        qrCodeData: ""
      };
      usersDb[userId].client = initializeClientForPhone(userId);
    }

    const existingAccounts = await getUserWhatsAppAccounts(userId);

    if (usersDb[userId].qrCodeData) {
      res.json({ 
        qrCode: usersDb[userId].qrCodeData,
        existingAccounts: existingAccounts,
        message: "Scan QR code to authenticate WhatsApp account"
      });
    } else if (usersDb[userId].currentAuth) {
      res.json({ 
        qrCode: null, 
        currentAccount: usersDb[userId].currentAuth,
        existingAccounts: existingAccounts,
        message: `WhatsApp account ${usersDb[userId].currentAuth} is authenticated!` 
      });
    } else {
      res.json({ 
        qrCode: null,
        existingAccounts: existingAccounts,
        message: "Generating QR code, please wait..."
      });
    }
  } catch (error) {
    console.error("Error in /qr route:", error);
    res.status(500).json({ error: "Error generating QR code" });
  }
});

// Route to switch to a specific WhatsApp account
router.post("/switch-account", authenticate, async (req, res) => {
  const userId = req.user._id.toString();
  const { phoneNumber } = req.body;

  try {
    const account = await WhatsAppAccount.findOne({ 
      userId, 
      phoneNumber, 
      isActive: true 
    });

    if (!account) {
      return res.status(404).json({ error: "WhatsApp account not found" });
    }

    if (usersDb[userId]?.accounts[phoneNumber]?.isAuthenticated) {
      usersDb[userId].currentAuth = phoneNumber;
      return res.json({ 
        message: `Switched to WhatsApp account ${phoneNumber}`,
        currentAccount: phoneNumber
      });
    }

    if (account.sessionData) {
      try {
        const sessionData = JSON.parse(account.sessionData);
        const client = initializeClientForPhone(userId, sessionData);
        
        setTimeout(() => {
          if (usersDb[userId]?.accounts[phoneNumber]?.isAuthenticated) {
            res.json({ 
              message: `Reconnected to WhatsApp account ${phoneNumber}`,
              currentAccount: phoneNumber
            });
          } else {
            res.status(400).json({ 
              error: `Failed to reconnect to ${phoneNumber}. Please scan QR code again.`,
              needsReauth: true
            });
          }
        }, 5000);
      } catch (parseError) {
        res.status(400).json({ 
          error: `Account ${phoneNumber} needs re-authentication`,
          needsReauth: true
        });
      }
    } else {
      res.status(400).json({ 
        error: `Account ${phoneNumber} needs re-authentication`,
        needsReauth: true
      });
    }

  } catch (error) {
    console.error("Error switching account:", error);
    res.status(500).json({ error: "Error switching account" });
  }
});

// Enhanced send route
router.post("/send", authenticate, upload.single("media"), async (req, res) => {
  const userId = req.user._id.toString();
  const { users, message, campaignName } = req.body;
  const mediaFile = req.file;

  try {
    if (!usersDb[userId]?.currentAuth) {
      return res.status(400).json({ 
        error: "No WhatsApp account authenticated. Please scan QR code first.",
        needsQR: true 
      });
    }

    const currentPhoneNumber = usersDb[userId].currentAuth;
    const currentAccount = usersDb[userId].accounts[currentPhoneNumber];

    if (!currentAccount?.isAuthenticated) {
      return res.status(400).json({ 
        error: `WhatsApp account ${currentPhoneNumber} is not authenticated`,
        needsQR: true 
      });
    }

    if (!users || !message) {
      return res.status(400).json({ error: "Users and message are required" });
    }

    const userArray = users.split("\n").map((user) => user.trim()).filter((user) => user);
    const validPhoneNumbers = [];
    const invalidUsers = [];

    for (const user of userArray) {
      const phoneNumber = parsePhoneNumberFromString(user, process.env.DEFAULT_COUNTRY_CODE || "IN");
      if (!phoneNumber || !phoneNumber.isValid()) {
        invalidUsers.push(user);
      } else {
        validPhoneNumbers.push({
          phoneNumber: phoneNumber.number.replace(/\D/g, ""),
          status: 'pending',
          trackingToken: require('crypto').randomBytes(16).toString('hex')
        });
      }
    }

    if (invalidUsers.length > 0) {
      return res.status(400).json({ 
        error: `Invalid phone numbers: ${invalidUsers.join(", ")}` 
      });
    }

    const client = currentAccount.client;
    const sentMessages = [];
    const failedMessages = [];

    const newCampaign = new Campaign({
      userId,
      senderPhoneNumber: currentPhoneNumber,
      campaignName: campaignName || `Campaign ${new Date().toISOString()}`,
      toolType: "whatsapp-bulk-sender",
      messageContent: message,
      recipients: validPhoneNumbers,
      status: "in-progress",
      totalSent: 0,
      totalFailed: 0,
      createdAt: new Date()
    });
    const savedCampaign = await newCampaign.save();

    for (let i = 0; i < validPhoneNumbers.length; i++) {
      const recipient = validPhoneNumbers[i];
      const phoneNumber = recipient.phoneNumber;
      
      try {
        const chatId = `${phoneNumber}@c.us`;
        
        const analyticsData = new WhatsAppAnalytics({
          userId,
          campaignId: savedCampaign._id,
          senderPhoneNumber: currentPhoneNumber,
          messageId: null,
          phoneNumber,
          messageContent: message,
          status: 'pending',
          sentAt: new Date(),
          trackingToken: recipient.trackingToken
        });
        
        let sentMessage;
        if (mediaFile) {
          const mediaData = MessageMedia.fromFilePath(mediaFile.path);
          sentMessage = await client.sendMessage(chatId, mediaData, { caption: message });
        } else {
          sentMessage = await client.sendMessage(chatId, message);
        }
        
        analyticsData.messageId = sentMessage.id._serialized;
        analyticsData.status = 'sent';
        
        try {
          await analyticsData.save();
        } catch (analyticsError) {
          if (analyticsError.code === 11000) {
            try {
              analyticsData.trackingToken = undefined;
              await analyticsData.save();
            } catch (retryError) {
              console.error("Analytics retry failed:", retryError.message);
            }
          }
        }
        
        sentMessages.push(phoneNumber);
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (messageError) {
        failedMessages.push({ phoneNumber, error: messageError.message });
        
        try {
          const failedAnalytics = new WhatsAppAnalytics({
            userId,
            campaignId: savedCampaign._id,
            senderPhoneNumber: currentPhoneNumber,
            messageId: null,
            phoneNumber,
            messageContent: message,
            status: 'failed',
            sentAt: new Date(),
            trackingToken: recipient.trackingToken,
            errorMessage: messageError.message
          });
          await failedAnalytics.save();
        } catch (failedAnalyticsError) {
          console.error("Failed to save failed message analytics:", failedAnalyticsError.message);
        }
      }
    }

    savedCampaign.totalSent = sentMessages.length;
    savedCampaign.totalFailed = failedMessages.length;
    savedCampaign.status = sentMessages.length > 0 ? "completed" : "failed";
    await savedCampaign.save();

    try {
      let campaignAnalytics = await CampaignAnalytics.findOne({ campaignId: savedCampaign._id });
      if (!campaignAnalytics) {
        campaignAnalytics = new CampaignAnalytics({ campaignId: savedCampaign._id });
      }
      await campaignAnalytics.updateAnalytics();
    } catch (analyticsError) {
      console.error("Campaign analytics update failed:", analyticsError.message);
    }

    try {
      await WhatsAppAccount.findOneAndUpdate(
        { userId, phoneNumber: currentPhoneNumber },
        { 
          $inc: { 
            campaignCount: 1,
            totalMessagesSent: sentMessages.length
          },
          lastConnected: new Date()
        }
      );
    } catch (accountError) {
      console.error("Account update failed:", accountError.message);
    }

    if (mediaFile && fs.existsSync(mediaFile.path)) {
      fs.unlinkSync(mediaFile.path);
    }

    const response = {
      success: true,
      message: `Campaign completed! Messages sent from ${currentPhoneNumber}`,
      campaignId: savedCampaign._id,
      senderPhone: currentPhoneNumber,
      totalSent: sentMessages.length,
      totalFailed: failedMessages.length,
      sentMessages,
      summary: {
        totalRecipients: validPhoneNumbers.length,
        successRate: validPhoneNumbers.length > 0 ? ((sentMessages.length / validPhoneNumbers.length) * 100).toFixed(1) + '%' : '0%',
        failureRate: validPhoneNumbers.length > 0 ? ((failedMessages.length / validPhoneNumbers.length) * 100).toFixed(1) + '%' : '0%'
      }
    };

    if (failedMessages.length > 0) {
      response.failedMessages = failedMessages;
    }

    res.status(200).json(response);

  } catch (error) {
    console.error("Error in send route:", error);
    
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
    const query = { userId, toolType: "whatsapp-bulk-sender" };
    if (phoneNumber) {
      query.senderPhoneNumber = phoneNumber;
    }

    const campaigns = await Campaign.find(query).sort({ createdAt: -1 });
    const userAccounts = await getUserWhatsAppAccounts(userId);

    const campaignsWithAnalytics = [];

    for (const campaign of campaigns) {
      const messageAnalytics = await WhatsAppAnalytics.find({ 
        campaignId: campaign._id,
        userId 
      });

      const totalMessages = messageAnalytics.length;
      const deliveredMessages = messageAnalytics.filter(m => 
        m.status === 'delivered' || m.status === 'read'
      ).length;
      const readMessages = messageAnalytics.filter(m => m.status === 'read').length;
      const deliveryRate = totalMessages > 0 ? (deliveredMessages / totalMessages) * 100 : 0;
      const openRate = totalMessages > 0 ? (readMessages / totalMessages) * 100 : 0;

      const senderAccount = userAccounts.find(acc => acc.phoneNumber === campaign.senderPhoneNumber);
      const isCurrentlyConnected = senderAccount?.isAuthenticated || false;

      campaignsWithAnalytics.push({
        campaignId: campaign._id,
        campaignName: campaign.campaignName,
        senderPhoneNumber: campaign.senderPhoneNumber,
        createdAt: campaign.createdAt,
        totalMessages: totalMessages,
        deliveryRate: Math.round(deliveryRate * 100) / 100,
        openRate: Math.round(openRate * 100) / 100,
        status: campaign.status,
        connectionStatus: {
          isConnected: isCurrentlyConnected,
          dataReliability: isCurrentlyConnected ? 'current' : 'historical'
        }
      });
    }

    res.json({ 
      campaigns: campaignsWithAnalytics,
      whatsappAccounts: userAccounts,
      currentAccount: usersDb[userId]?.currentAuth || null,
      totalAccounts: userAccounts.length
    });

  } catch (error) {
    console.error("Error fetching analytics:", error);
    res.status(500).json({ error: "Error fetching analytics", details: error.message });
  }
});

// Route to get account-specific analytics
router.get("/analytics/account/:phoneNumber", authenticate, async (req, res) => {
  const userId = req.user._id.toString();
  const { phoneNumber } = req.params;

  try {
    const campaigns = await Campaign.find({ 
      userId, 
      senderPhoneNumber: phoneNumber,
      toolType: "whatsapp-bulk-sender" 
    }).sort({ createdAt: -1 });

    const account = await WhatsAppAccount.findOne({ userId, phoneNumber });
    if (!account) {
      return res.status(404).json({ error: "WhatsApp account not found" });
    }

    const accountAnalytics = {
      phoneNumber: phoneNumber,
      isAuthenticated: account.isAuthenticated,
      lastConnected: account.lastConnected,
      totalCampaigns: campaigns.length,
      campaigns: []
    };

    for (const campaign of campaigns) {
      const messageAnalytics = await WhatsAppAnalytics.find({ 
        campaignId: campaign._id,
        senderPhoneNumber: phoneNumber
      });

      const totalMessages = messageAnalytics.length;
      const deliveredMessages = messageAnalytics.filter(m => 
        m.status === 'delivered' || m.status === 'read'
      ).length;
      const readMessages = messageAnalytics.filter(m => m.status === 'read').length;

      accountAnalytics.campaigns.push({
        campaignId: campaign._id,
        campaignName: campaign.campaignName,
        createdAt: campaign.createdAt,
        totalMessages,
        deliveredMessages,
        readMessages,
        deliveryRate: totalMessages > 0 ? Math.round((deliveredMessages / totalMessages) * 10000) / 100 : 0,
        openRate: totalMessages > 0 ? Math.round((readMessages / totalMessages) * 10000) / 100 : 0
      });
    }

    res.json(accountAnalytics);

  } catch (error) {
    console.error("Error fetching account analytics:", error);
    res.status(500).json({ error: "Error fetching account analytics" });
  }
});

// Route to disconnect a specific WhatsApp account
router.post("/disconnect", authenticate, async (req, res) => {
  const userId = req.user._id.toString();
  const { phoneNumber } = req.body;

  try {
    if (usersDb[userId]?.accounts[phoneNumber]) {
      const account = usersDb[userId].accounts[phoneNumber];
      if (account.client) {
        await account.client.destroy();
      }
      delete usersDb[userId].accounts[phoneNumber];
      
      if (usersDb[userId].currentAuth === phoneNumber) {
        usersDb[userId].currentAuth = null;
      }
    }

    await WhatsAppAccount.findOneAndUpdate(
      { userId, phoneNumber },
      {
        isAuthenticated: false,
        lastDisconnected: new Date()
      }
    );

    res.json({ message: `WhatsApp account ${phoneNumber} disconnected successfully` });

  } catch (error) {
    console.error("Error disconnecting account:", error);
    res.status(500).json({ error: "Error disconnecting account" });
  }
});

// Manual sync route for checking message statuses
router.post("/sync-status", authenticate, async (req, res) => {
  const userId = req.user._id.toString();
  const { phoneNumber } = req.body;

  try {
    if (!usersDb[userId]?.accounts[phoneNumber]?.isAuthenticated) {
      return res.status(400).json({ 
        error: `WhatsApp account ${phoneNumber} is not authenticated` 
      });
    }

    const client = usersDb[userId].accounts[phoneNumber].client;
    await checkPendingMessageStatuses(client, phoneNumber, userId);
    
    res.json({ 
      message: `Status sync completed for ${phoneNumber}`,
      success: true 
    });

  } catch (error) {
    console.error("Error in manual sync:", error);
    res.status(500).json({ error: "Error syncing message statuses" });
  }
});

// Cleanup on server shutdown
process.on('SIGINT', () => {
  console.log('Cleaning up WhatsApp clients...');
  Object.keys(usersDb).forEach(cleanupUserSession);
  process.exit(0);
});

module.exports = router;