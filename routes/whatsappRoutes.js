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

// Models - Removed LinkClick import
const { Campaign, WhatsAppAnalytics, CampaignAnalytics } = require("../models/Whatsapp-Campaign");

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
    usersDb[userId].session = client.session;
  });

  client.on("disconnected", () => {
    console.log(`Client disconnected for user ${userId}`);
    delete usersDb[userId];
  });

  // Message status tracking
  client.on("message_ack", async (msg, ack) => {
    try {
      const messageId = msg.id._serialized;
      let status = "sent";
      
      // WhatsApp acknowledgment types:
      // 0: Message sent
      // 1: Message delivered to server
      // 2: Message delivered to recipient
      // 3: Message read by recipient
      switch (ack) {
        case 1:
          status = "sent";
          break;
        case 2:
          status = "delivered";
          break;
        case 3:
          status = "read";
          break;
      }

      // Update analytics
      const analytics = await WhatsAppAnalytics.findOne({ messageId });
      if (analytics) {
        analytics.status = status;
        if (status === "delivered") {
          analytics.deliveredAt = new Date();
        } else if (status === "read") {
          analytics.readAt = new Date();
        }
        await analytics.save();

        // Update campaign analytics
        const campaignAnalytics = await CampaignAnalytics.findOne({ campaignId: analytics.campaignId });
        if (campaignAnalytics) {
          await campaignAnalytics.updateAnalytics();
        }
      }
    } catch (error) {
      console.error("Error updating message status:", error);
    }
  });

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
  const userId = req.user._id.toString();

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

// Route to send messages with campaign feature - Simplified without link tracking
router.post("/send", authenticate, upload.single("media"), async (req, res) => {
  const userId = req.user._id.toString();
  const { users, message, campaignName } = req.body;
  const mediaFile = req.file;

  console.log(`DEBUG: Processing request for user: ${userId}`);
  console.log(`DEBUG: Request body:`, req.body);
  console.log(`DEBUG: Media file:`, mediaFile ? mediaFile.filename : 'No media');

  if (!users || !message || !campaignName) {
    return res.status(400).json({ error: "Please provide users, message, and campaign name" });
  }

  // Check if WhatsApp client exists and is authenticated
  if (!usersDb[userId]) {
    console.log(`DEBUG: No WhatsApp client found for user ${userId}`);
    return res.status(400).json({ 
      error: "WhatsApp client not initialized. Please scan QR code first.",
      needsQR: true 
    });
  }

  if (!usersDb[userId].isAuthenticated) {
    console.log(`DEBUG: WhatsApp client not authenticated for user ${userId}`);
    return res.status(400).json({ 
      error: "WhatsApp not authenticated. Please scan QR code first.",
      needsQR: true 
    });
  }

// Replace this section in your /send route (around line 180-250)

  const userArray = users.split("\n").map((user) => user.trim()).filter((user) => user);
  const invalidUsers = [];
  const validPhoneNumbers = [];

  console.log(`DEBUG: Processing ${userArray.length} phone numbers`);

  for (const user of userArray) {
    const phoneNumber = parsePhoneNumberFromString(user, process.env.DEFAULT_COUNTRY_CODE || "IN");
    if (!phoneNumber || !phoneNumber.isValid()) {
      invalidUsers.push(user);
    } else {
      // Create recipient objects with required trackingToken
      validPhoneNumbers.push({
        phoneNumber: phoneNumber.number.replace(/\D/g, ""),
        status: 'pending',
        trackingToken: require('crypto').randomBytes(16).toString('hex') // Generate unique tracking token
      });
    }
  }

  if (invalidUsers.length > 0) {
    console.log(`DEBUG: Invalid phone numbers found:`, invalidUsers);
    return res.status(400).json({ error: `Invalid phone numbers: ${invalidUsers.join(", ")}` });
  }

  console.log(`DEBUG: Valid phone numbers: ${validPhoneNumbers.length}`);
  const client = usersDb[userId].client;

  try {
    const sentMessages = [];
    const failedMessages = [];

    // Create the campaign with recipient objects
    const newCampaign = new Campaign({
      userId,
      campaignName,
      toolType: "whatsapp-bulk-sender",
      messageContent: message,
      recipients: validPhoneNumbers, // Now this is an array of objects
      status: "in-progress",
      totalSent: 0,
      totalFailed: 0,
      createdAt: new Date()
    });
    const savedCampaign = await newCampaign.save();
    console.log(`DEBUG: Campaign created with ID: ${savedCampaign._id}`);

    // Update the loop to use the phoneNumber property
    for (const recipient of validPhoneNumbers) {
      const phoneNumber = recipient.phoneNumber;
      try {
        const chatId = `${phoneNumber}@c.us`;
        
        let sentMessage;
        if (mediaFile) {
          const mediaPath = mediaFile.path;
          console.log(`DEBUG: Sending media message to ${phoneNumber}`);
          const mediaData = MessageMedia.fromFilePath(mediaPath);
          sentMessage = await client.sendMessage(chatId, mediaData, { caption: message });
        } else {
          console.log(`DEBUG: Sending text message to ${phoneNumber}`);
          sentMessage = await client.sendMessage(chatId, message);
        }
        
        console.log(`✅ Message sent to ${phoneNumber}`);
        sentMessages.push(phoneNumber);

        // Create WhatsAppAnalytics record for this message
        const analyticsData = new WhatsAppAnalytics({
          userId,
          campaignId: savedCampaign._id,
          messageId: sentMessage.id._serialized,
          phoneNumber,
          messageContent: message,
          status: 'sent',
          sentAt: new Date()
        });
        await analyticsData.save();
        
        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (messageError) {
        console.error(`❌ Failed to send message to ${phoneNumber}:`, messageError.message);
        failedMessages.push({ phoneNumber, error: messageError.message });
      }
    }

    // Update campaign with final results - create recipient objects for sent messages
    const sentRecipients = sentMessages.map(phone => ({ 
      phoneNumber: phone, 
      status: 'sent',
      trackingToken: require('crypto').randomBytes(16).toString('hex') // Generate tracking token for sent messages
    }));
    
    savedCampaign.totalSent = sentMessages.length;
    savedCampaign.totalFailed = failedMessages.length;
    savedCampaign.recipients = sentRecipients; // Update with recipient objects
    savedCampaign.status = sentMessages.length > 0 ? "completed" : "failed";
    await savedCampaign.save();

    // Rest of the code remains the same...
    // Create or update CampaignAnalytics (simplified without click tracking)
    let campaignAnalytics = await CampaignAnalytics.findOne({ campaignId: savedCampaign._id });
    if (!campaignAnalytics) {
      campaignAnalytics = new CampaignAnalytics({
        campaignId: savedCampaign._id,
        userId,
        totalMessages: sentMessages.length,
        deliveredMessages: 0, // Will be updated when we get delivery confirmations
        readMessages: 0,
        failedMessages: failedMessages.length,
        deliveryRate: 0,
        openRate: 0,
        lastUpdated: new Date()
      });
      await campaignAnalytics.save();
    } else {
      await campaignAnalytics.updateAnalytics();
    }

    // Clean up media file
    if (mediaFile && fs.existsSync(mediaFile.path)) {
      fs.unlinkSync(mediaFile.path);
      console.log(`DEBUG: Cleaned up media file: ${mediaFile.path}`);
    }

    const responseMessage = `Messages processed: ${sentMessages.length} sent, ${failedMessages.length} failed`;
    
    res.status(200).json({
      message: responseMessage,
      campaignId: savedCampaign._id,
      totalSent: sentMessages.length,
      totalFailed: failedMessages.length,
      sentMessages,
      failedMessages: failedMessages.length > 0 ? failedMessages : undefined,
    });

  } catch (error) {
    console.error("❌ Error in /whatsapp/send:", error);
    
    // Clean up media file on error
    if (mediaFile && fs.existsSync(mediaFile.path)) {
      fs.unlinkSync(mediaFile.path);
    }
    
    res.status(500).json({ 
      error: "Error sending messages", 
      details: error.message 
    });
  }
});

// Analytics route - Simplified without link tracking
router.get("/analytics", authenticate, async (req, res) => {
  const userId = req.user._id.toString();

  try {
    // Get campaigns from the Campaign model
    const campaigns = await Campaign.find({ 
      userId,
      toolType: "whatsapp-bulk-sender" 
    }).sort({ createdAt: -1 });

    const campaignsWithAnalytics = [];

    for (const campaign of campaigns) {
      // Get analytics for each campaign
      const messageAnalytics = await WhatsAppAnalytics.find({ 
        campaignId: campaign._id,
        userId 
      });

      // Calculate metrics (without click tracking)
      const totalMessages = messageAnalytics.length;
      const deliveredMessages = messageAnalytics.filter(m => m.status === 'delivered' || m.status === 'read').length;
      const readMessages = messageAnalytics.filter(m => m.status === 'read').length;
      const failedMessages = campaign.totalFailed || 0;

      const deliveryRate = totalMessages > 0 ? (deliveredMessages / totalMessages) * 100 : 0;
      const openRate = totalMessages > 0 ? (readMessages / totalMessages) * 100 : 0;

      campaignsWithAnalytics.push({
        campaignId: campaign._id,
        campaignName: campaign.campaignName,
        createdAt: campaign.createdAt,
        totalMessages: totalMessages,
        deliveryRate: Math.round(deliveryRate * 100) / 100,
        openRate: Math.round(openRate * 100) / 100,
        status: campaign.status
      });
    }

    res.json({ campaigns: campaignsWithAnalytics });

  } catch (error) {
    console.error("Error fetching all analytics:", error);
    res.status(500).json({ error: "Error fetching analytics", details: error.message });
  }
});

// Individual campaign analytics route - Simplified without link tracking
router.get("/analytics/:campaignId", authenticate, async (req, res) => {
  const { campaignId } = req.params;
  const userId = req.user._id.toString();

  try {
    // Get campaign from Campaign model
    const campaign = await Campaign.findOne({ 
      _id: campaignId, 
      userId,
      toolType: "whatsapp-bulk-sender"
    });

    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    // Get detailed message analytics
    const messageAnalytics = await WhatsAppAnalytics.find({ 
      campaignId, 
      userId 
    }).select('phoneNumber status sentAt deliveredAt readAt');

    // Calculate metrics (without click tracking)
    const totalMessages = messageAnalytics.length;
    const deliveredMessages = messageAnalytics.filter(m => m.status === 'delivered' || m.status === 'read').length;
    const readMessages = messageAnalytics.filter(m => m.status === 'read').length;
    const failedMessages = campaign.totalFailed || 0;

    const deliveryRate = totalMessages > 0 ? (deliveredMessages / totalMessages) * 100 : 0;
    const openRate = totalMessages > 0 ? (readMessages / totalMessages) * 100 : 0;

    res.json({
      summary: {
        campaignName: campaign.campaignName,
        totalMessages: totalMessages,
        deliveredMessages: deliveredMessages,
        readMessages: readMessages,
        failedMessages: failedMessages,
        deliveryRate: Math.round(deliveryRate * 100) / 100,
        openRate: Math.round(openRate * 100) / 100,
        lastUpdated: new Date(),
      },
      messageDetails: messageAnalytics
    });

  } catch (error) {
    console.error("Error fetching analytics:", error);
    res.status(500).json({ error: "Error fetching analytics", details: error.message });
  }
});

module.exports = router;