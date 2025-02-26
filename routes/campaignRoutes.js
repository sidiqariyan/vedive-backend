const express = require("express");
const router = express.Router();
const Campaign = require("../models/Campaign");
const { authenticate } = require("../middleware/authMiddleware");

// Create a new campaign
router.post("/create-campaign", authenticate, async (req, res) => {
  try {
    const {
      campaignName,
      toolType,
      smtpHost,
      smtpPort,
      smtpUsername, // Added for consistency with previous endpoints
      smtpPassword, // Added for consistency with previous endpoints
      fromEmail,
      emailSubject,
      recipients,
      query,
      scrapedNumbers,
      messageContent,
    } = req.body;

    // Validate required fields
    if (!campaignName || !toolType || !fromEmail) {
      return res.status(400).json({ error: "Missing required fields: campaignName, toolType, or fromEmail" });
    }

    // Ensure recipients is an array
    let recipientList = [];
    try {
      recipientList = Array.isArray(recipients) ? recipients : JSON.parse(recipients || "[]");
    } catch (error) {
      return res.status(400).json({ error: "Invalid recipients format. Must be an array." });
    }

    // Validate email addresses if toolType involves emailing
    if (
      (toolType === "mail-sender" || toolType === "gmail-sender") &&
      recipientList.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    ) {
      return res.status(400).json({ error: "Invalid email address found in recipients list." });
    }

    // Create a new campaign associated with the logged-in user
    const newCampaign = new Campaign({
      userId: req.user._id,
      campaignName,
      toolType,
      smtpHost: smtpHost || "",
      smtpPort: smtpPort ? parseInt(smtpPort) : 587, // Default SMTP port
      smtpUsername: smtpUsername || "",
      smtpPassword: smtpPassword || "", // Store securely (consider encryption in production)
      fromEmail,
      emailSubject: emailSubject || "",
      recipients: recipientList,
      query: query || "",
      scrapedNumbers: Array.isArray(scrapedNumbers) ? scrapedNumbers : [],
      messageContent: messageContent || "",
      status: "pending", // Default status
      createdAt: new Date(), // Explicitly set creation date
    });

    await newCampaign.save();

    res.status(201).json({
      message: "Campaign created successfully",
      campaign: {
        _id: newCampaign._id,
        campaignName: newCampaign.campaignName,
        toolType: newCampaign.toolType,
        fromEmail: newCampaign.fromEmail,
        emailSubject: newCampaign.emailSubject,
        recipients: newCampaign.recipients,
        status: newCampaign.status,
        createdAt: newCampaign.createdAt,
      }, // Return sanitized campaign data, excluding sensitive fields like smtpPassword
    });
  } catch (error) {
    console.error("Error creating campaign:", error);
    res.status(500).json({ error: "Failed to create campaign. Please try again." });
  }
});

// Fetch all campaigns for the authenticated user
router.get("/campaigns", authenticate, async (req, res) => {
  try {
    const campaigns = await Campaign.find({ userId: req.user._id })
      .select("-smtpPassword") // Exclude sensitive fields
      .sort({ createdAt: -1 }); // Sort by most recent first
    res.status(200).json(campaigns);
  } catch (error) {
    console.error("Error fetching campaigns:", error.message);
    res.status(500).json({ error: "Failed to fetch campaigns" });
  }
});

module.exports = router;