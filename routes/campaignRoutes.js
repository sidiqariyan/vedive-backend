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
       smtpUsername,
       smtpPassword,
       fromEmail,
       emailSubject,
       recipients,
       query,
       scrapedNumbers,
       messageContent,
     } = req.body;
 
     if (!campaignName || !toolType || !fromEmail) {
       return res.status(400).json({ error: "Missing required fields: campaignName, toolType, or fromEmail" });
     }
 
     let recipientList = [];
     console.log("Processing recipients:", recipients);
     if (Array.isArray(recipients)) {
       recipientList = recipients;
     } else if (typeof recipients === "string" && recipients.trim()) {
       try {
         recipientList = JSON.parse(recipients);
         if (!Array.isArray(recipientList)) {
           return res.status(400).json({ error: "Parsed recipients must be an array" });
         }
       } catch (error) {
         console.error("Failed to parse recipients:", recipients, "Error:", error.message);
         return res.status(400).json({ error: "Invalid recipients format. Expected a JSON array." });
       }
     } else {
       recipientList = [];
     }
 
     let numbersList = [];
     console.log("Processing scrapedNumbers:", scrapedNumbers);
     if (Array.isArray(scrapedNumbers)) {
       numbersList = scrapedNumbers;
     } else if (typeof scrapedNumbers === "string" && scrapedNumbers.trim()) {
       try {
         numbersList = JSON.parse(scrapedNumbers);
         if (!Array.isArray(numbersList)) {
           return res.status(400).json({ error: "Parsed scrapedNumbers must be an array" });
         }
       } catch (error) {
         console.error("Failed to parse scrapedNumbers:", scrapedNumbers, "Error:", error.message);
         return res.status(400).json({ error: "Invalid scrapedNumbers format. Expected a JSON array." });
       }
     } else {
       numbersList = [];
     }
 
     if (
       (toolType === "mail-sender" || toolType === "gmail-sender") &&
       recipientList.length > 0 &&
       recipientList.some((email) => !isValidEmail(email))
     ) {
       return res.status(400).json({ error: "Invalid email address in recipients list" });
     }
 
     const newCampaign = new Campaign({
       userId: req.user._id,
       campaignName,
       toolType,
       smtpHost: smtpHost || "",
       smtpPort: smtpPort ? parseInt(smtpPort) : 587,
       smtpUsername: smtpUsername || "",
       smtpPassword: smtpPassword || "",
       fromEmail,
       emailSubject: emailSubject || "",
       recipients: recipientList,
       query: query || "",
       scrapedNumbers: numbersList,
       messageContent: messageContent || "",
       status: "pending",
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
         scrapedNumbers: newCampaign.scrapedNumbers,
         status: newCampaign.status,
         createdAt: newCampaign.createdAt,
       },
     });
   } catch (error) {
     console.error("Error in /create-campaign:", error.stack);
     res.status(500).json({ error: "Failed to create campaign" });
   }
});

module.exports = router;