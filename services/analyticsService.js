const { 
  Campaign, 
  WhatsAppAnalytics, 
  WhatsAppAccount
} = require("../models/Whatsapp-Campaign");

class AnalyticsService {
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

  async getCampaignAnalytics(userId, phoneNumber = null) {
    const query = { userId, toolType: "whatsapp-bulk-sender" };
    if (phoneNumber) {
      query.senderPhoneNumber = phoneNumber;
    }

    const campaigns = await Campaign.find(query).sort({ createdAt: -1 });
    const userAccounts = await this.getUserWhatsAppAccounts(userId);

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

    return { 
      campaigns: campaignsWithAnalytics,
      whatsappAccounts: userAccounts,
      totalAccounts: userAccounts.length
    };
  }

  async getAccountAnalytics(userId, phoneNumber) {
    const campaigns = await Campaign.find({ 
      userId, 
      senderPhoneNumber: phoneNumber,
      toolType: "whatsapp-bulk-sender" 
    }).sort({ createdAt: -1 });

    const account = await WhatsAppAccount.findOne({ userId, phoneNumber });
    if (!account) {
      throw new Error("WhatsApp account not found");
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

    return accountAnalytics;
  }
}

module.exports = AnalyticsService;