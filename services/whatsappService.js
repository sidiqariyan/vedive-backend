const { Client, MessageMedia } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const fs = require("fs");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const { 
  Campaign, 
  WhatsAppAnalytics, 
  CampaignAnalytics,
  WhatsAppAccount
} = require("../models/Whatsapp-Campaign");

class WhatsAppService {
  constructor() {
    this.usersDb = {};
  }

  async getUserWhatsAppAccounts(userId) {
    try {
      const accounts = await WhatsAppAccount.find({ userId, isActive: true });
      return accounts.map(acc => ({
        phoneNumber: acc.phoneNumber,
        isAuthenticated: acc.isAuthenticated,
        lastConnected: acc.lastConnected,
        campaignCount: acc.campaignCount || 0
      }));
    } catch (error) {
      return [];
    }
  }

  cleanupUserSession(userId) {
    if (this.usersDb[userId]) {
      Object.values(this.usersDb[userId].accounts).forEach(account => {
        if (account.client) {
          try {
            account.client.destroy();
          } catch (error) {
            // Silent cleanup
          }
        }
      });
      delete this.usersDb[userId];
    }
  }

  async updateMessageAnalytics(messageId, status, phoneNumber, userId) {
    try {
      const phoneMatch = messageId.match(/(\d{10,15})/);
      if (!phoneMatch) return;
      
      const extractedPhone = phoneMatch[1];
      let analytics = await this.findAnalyticsRecord(messageId, extractedPhone, phoneNumber, userId);
      
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
          this.updateCampaignAnalyticsBackground(analytics.campaignId);
        }
      }
    } catch (error) {
      // Silent error handling
    }
  }

  async findAnalyticsRecord(messageId, extractedPhone, phoneNumber, userId) {
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
    
    return null;
  }

  updateCampaignAnalyticsBackground(campaignId) {
    setImmediate(async () => {
      try {
        const campaignAnalytics = await CampaignAnalytics.findOne({ campaignId });
        if (campaignAnalytics) {
          await campaignAnalytics.updateAnalytics();
        }
      } catch (error) {
        // Silent error handling
      }
    });
  }

  setupMessageAckHandler(client, phoneNumber, userId) {
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

        await this.updateMessageAnalytics(messageId, status, phoneNumber, userId);
      } catch (error) {
        // Silent error handling
      }
    });
  }

  initializeClientForPhone(userId, sessionId = null) {
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
      if (!this.usersDb[userId]) {
        this.usersDb[userId] = { accounts: {}, currentAuth: null };
      }
      try {
        this.usersDb[userId].qrCodeData = await QRCode.toDataURL(qr);
      } catch (error) {
        // Silent error handling
      }
    });

    client.on("ready", async () => {
      try {
        const info = client.info;
        detectedPhoneNumber = info.wid.user;
        
        if (!this.usersDb[userId]) {
          this.usersDb[userId] = { accounts: {}, currentAuth: null };
        }
        
        this.usersDb[userId].accounts[detectedPhoneNumber] = {
          client: client,
          isAuthenticated: true,
          phoneNumber: detectedPhoneNumber,
          authenticatedAt: new Date(),
          qrCodeData: ""
        };
        
        this.usersDb[userId].currentAuth = detectedPhoneNumber;
        this.usersDb[userId].qrCodeData = "";

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

        this.setupMessageAckHandler(client, detectedPhoneNumber, userId);
      } catch (error) {
        // Silent error handling
      }
    });

    client.on("disconnected", async () => {
      if (detectedPhoneNumber && this.usersDb[userId]?.accounts[detectedPhoneNumber]) {
        this.usersDb[userId].accounts[detectedPhoneNumber].isAuthenticated = false;
        
        try {
          await WhatsAppAccount.findOneAndUpdate(
            { userId, phoneNumber: detectedPhoneNumber },
            {
              isAuthenticated: false,
              lastDisconnected: new Date()
            }
          );
        } catch (error) {
          // Silent error handling
        }
      }
    });

    client.on("auth_failure", (msg) => {
      if (this.usersDb[userId]) {
        this.usersDb[userId].authFailed = true;
      }
    });

    client.initialize();
    return client;
  }

  async getQRCode(userId) {
    if (!this.usersDb[userId]) {
      this.usersDb[userId] = { 
        accounts: {}, 
        currentAuth: null,
        qrCodeData: ""
      };
      this.usersDb[userId].client = this.initializeClientForPhone(userId);
    }

    const existingAccounts = await this.getUserWhatsAppAccounts(userId);

    if (this.usersDb[userId].qrCodeData) {
      return { 
        qrCode: this.usersDb[userId].qrCodeData,
        existingAccounts: existingAccounts,
        message: "Scan QR code to authenticate WhatsApp account"
      };
    } else if (this.usersDb[userId].currentAuth) {
      return { 
        qrCode: null, 
        currentAccount: this.usersDb[userId].currentAuth,
        existingAccounts: existingAccounts,
        message: `WhatsApp account ${this.usersDb[userId].currentAuth} is authenticated!` 
      };
    } else {
      return { 
        qrCode: null,
        existingAccounts: existingAccounts,
        message: "Generating QR code, please wait..."
      };
    }
  }

  async disconnectAccount(userId, phoneNumber) {
    // Remove from memory
    if (this.usersDb[userId]?.accounts[phoneNumber]) {
      delete this.usersDb[userId].accounts[phoneNumber];
    }

    // If this was the current auth, clear it
    if (this.usersDb[userId]?.currentAuth === phoneNumber) {
      this.usersDb[userId].currentAuth = null;
    }

    // Update database
    await WhatsAppAccount.findOneAndUpdate(
      { userId, phoneNumber },
      { sessionData: null, lastConnected: new Date() }
    );

    return { 
      message: `Disconnected WhatsApp account ${phoneNumber}`,
      success: true 
    };
  }

  async switchAccount(userId, phoneNumber) {
    const account = await WhatsAppAccount.findOne({ 
      userId, 
      phoneNumber, 
      isActive: true 
    });

    if (!account) {
      throw new Error("WhatsApp account not found");
    }

    if (this.usersDb[userId]?.accounts[phoneNumber]?.isAuthenticated) {
      this.usersDb[userId].currentAuth = phoneNumber;
      return { 
        message: `Switched to WhatsApp account ${phoneNumber}`,
        currentAccount: phoneNumber
      };
    }

    if (account.sessionData) {
      try {
        const sessionData = JSON.parse(account.sessionData);
        this.initializeClientForPhone(userId, sessionData);
        return { 
          message: `Reconnecting to WhatsApp account ${phoneNumber}`,
          pending: true,
          phoneNumber
        };
      } catch (parseError) {
        return { 
          error: `Account ${phoneNumber} needs re-authentication`,
          needsReauth: true
        };
      }
    } else {
      return { 
        error: `Account ${phoneNumber} needs re-authentication`,
        needsReauth: true
      };
    }
  }

  async checkAccountStatus(userId, phoneNumber) {
    if (this.usersDb[userId]?.accounts[phoneNumber]?.isAuthenticated) {
      return { 
        message: `Reconnected to WhatsApp account ${phoneNumber}`,
        currentAccount: phoneNumber
      };
    } else {
      return { 
        error: `Failed to reconnect to ${phoneNumber}. Please scan QR code again.`,
        needsReauth: true
      };
    }
  }

  async sendBulkMessages({ userId, users, message, campaignName, mediaFile }) {
    if (!this.usersDb[userId]?.currentAuth) {
      throw new Error("No WhatsApp account authenticated. Please scan QR code first.");
    }

    const currentPhoneNumber = this.usersDb[userId].currentAuth;
    const currentAccount = this.usersDb[userId].accounts[currentPhoneNumber];

    if (!currentAccount?.isAuthenticated) {
      throw new Error(`WhatsApp account ${currentPhoneNumber} is not authenticated`);
    }

    if (!users || !message) {
      throw new Error("Users and message are required");
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
      throw new Error(`Invalid phone numbers: ${invalidUsers.join(", ")}`);
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
              // Silent retry error
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
          // Silent error handling
        }
      }
    }

    savedCampaign.totalSent = sentMessages.length;
    savedCampaign.totalFailed = failedMessages.length;
    savedCampaign.status = sentMessages.length > 0 ? "completed" : "failed";
    await savedCampaign.save();

    // Update campaign analytics
    try {
      let campaignAnalytics = await CampaignAnalytics.findOne({ campaignId: savedCampaign._id });
      if (!campaignAnalytics) {
        campaignAnalytics = new CampaignAnalytics({ campaignId: savedCampaign._id });
      }
      await campaignAnalytics.updateAnalytics();
    } catch (analyticsError) {
      // Silent error handling
    }

    // Update account statistics
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
      // Silent error handling
    }

    // Cleanup media file
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

    return response;
  }

  cleanup() {
    Object.keys(this.usersDb).forEach(userId => this.cleanupUserSession(userId));
  }
   async safeLogout(client, sessionId) {
    try {
      console.log(`Attempting to logout session: ${sessionId}`);
      await client.logout();
      console.log(`Session ${sessionId} logged out successfully`);
      return { success: true };
    } catch (error) {
      if (error.message.includes('EBUSY') || 
          error.message.includes('resource busy') || 
          error.message.includes('unlink')) {
        console.warn(`Windows file lock during logout for ${sessionId}:`, error.message);
        
        // Schedule a delayed cleanup
        setTimeout(async () => {
          await this.delayedCleanup(sessionId);
        }, 5000);
        
        return { 
          success: true, 
          warning: 'Session disconnected, cleanup pending' 
        };
      }
      throw error;
    }
  }

  // Delayed cleanup for locked files
  async delayedCleanup(sessionId) {
    try {
      const sessionPath = path.join('.wwebjs_auth', `session-${sessionId}`);
      if (fs.existsSync(sessionPath)) {
        await fs.promises.rmdir(sessionPath, { recursive: true });
        console.log(`Delayed cleanup successful for session: ${sessionId}`);
      }
    } catch (error) {
      console.warn(`Delayed cleanup failed for ${sessionId}:`, error.message);
    }
  }

  // Enhanced disconnect account method
  async disconnectAccount(userId, phoneNumber) {
    const sessionId = this.generateSessionId(userId, phoneNumber);
    const client = this.clients.get(sessionId);

    if (!client) {
      throw new Error(`No active session found for ${phoneNumber}`);
    }

    try {
      // Use safe logout
      const logoutResult = await this.safeLogout(client, sessionId);
      
      // Remove from active clients
      this.clients.delete(sessionId);
      
      // Update database status
      await WhatsAppAccount.findOneAndUpdate(
        { userId, phoneNumber },
        { 
          isAuthenticated: false, 
          lastDisconnected: new Date(),
          status: 'disconnected'
        }
      );

      return {
        success: true,
        message: `Account ${phoneNumber} disconnected successfully`,
        warning: logoutResult.warning
      };

    } catch (error) {
      console.error(`Error disconnecting ${phoneNumber}:`, error);
      
      // Even if logout fails, remove from active clients and update DB
      this.clients.delete(sessionId);
      
      try {
        await WhatsAppAccount.findOneAndUpdate(
          { userId, phoneNumber },
          { 
            isAuthenticated: false, 
            lastDisconnected: new Date(),
            status: 'disconnected'
          }
        );
      } catch (dbError) {
        console.error('Database update failed:', dbError);
      }

      throw error;
    }
  }

  // Enhanced remove account method
  async removeAccount(userId, phoneNumber) {
    const sessionId = this.generateSessionId(userId, phoneNumber);
    
    try {
      // First try to disconnect if connected
      const client = this.clients.get(sessionId);
      if (client) {
        try {
          await this.safeLogout(client, sessionId);
        } catch (error) {
          console.warn('Logout failed during removal, continuing:', error.message);
        }
        this.clients.delete(sessionId);
      }

      // Remove from database
      const result = await WhatsAppAccount.findOneAndDelete({ userId, phoneNumber });
      
      if (!result) {
        throw new Error(`Account ${phoneNumber} not found`);
      }

      return {
        success: true,
        message: `Account ${phoneNumber} removed successfully`
      };

    } catch (error) {
      console.error(`Error removing account ${phoneNumber}:`, error);
      throw error;
    }
  }

  // Enhanced cleanup method for graceful shutdown
  async cleanup() {
    console.log('Starting WhatsApp service cleanup...');
    const cleanupPromises = [];

    for (const [sessionId, client] of this.clients.entries()) {
      cleanupPromises.push(
        this.safeLogout(client, sessionId).catch(error => {
          console.warn(`Cleanup failed for ${sessionId}:`, error.message);
        })
      );
    }

    try {
      // Wait for all cleanups to complete or timeout
      await Promise.allSettled(cleanupPromises);
      this.clients.clear();
      console.log('WhatsApp service cleanup completed');
    } catch (error) {
      console.warn('Some cleanup operations failed:', error.message);
    }
  }

  // Add this helper method if not already present
  generateSessionId(userId, phoneNumber) {
    return `${userId}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
}

module.exports = WhatsAppService;