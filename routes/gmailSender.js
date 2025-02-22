const express = require("express");
const router = express.Router();
const nodemailer = require("nodemailer");
const mongoose = require("mongoose");
const Campaign = require("../models/Campaign"); // Import the Campaign model

// API endpoint to send Gmail emails
router.post("/send-gmail", async (req, res) => {
    const { gmail, appPassword, from, subject, contacts, body, campaignName } = req.body;

    // Validate required fields
    if (!gmail || !appPassword || !from || !subject || !contacts || !body || !campaignName) {
        return res.status(400).send({ message: "All fields and campaign name are required." });
    }

    // Configure Nodemailer transporter
    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: gmail, pass: appPassword },
    });

    // Function to send an email
    const sendEmail = async (contact) => {
        try {
            const mailOptions = { from, to: contact, subject, html: body };
            const info = await transporter.sendMail(mailOptions);
            console.log(`Email sent to ${contact}: ${info.response}`);
            return { contact, status: "success", response: info.response };
        } catch (error) {
            console.error(`Failed to send email to ${contact}:`, error);
            return { contact, status: "failed", error: error.message };
        }
    };

    try {
        let results = [];
        for (let i = 0; i < contacts.length; i++) {
            const result = await sendEmail(contacts[i]);
            results.push(result);
            await new Promise((resolve) => setTimeout(resolve, 2000)); // Delay between emails
        }

        // Collect failed emails
        const failedEmails = results.filter((result) => result.status === "failed");

        // Save campaign data to MongoDB
        const newCampaign = new Campaign({
            campaignName,
            toolType: "gmail-sender",
            smtpHost: "smtp.gmail.com",
            smtpPort: 587,
            smtpUsername: gmail,
            smtpPassword: appPassword,
            fromEmail: from,
            emailSubject: subject,
            recipients: contacts,
        });

        await newCampaign.save();

        // Respond based on email sending results
        if (failedEmails.length > 0) {
            return res.status(500).send({
                message: "Some emails failed to send.",
                errors: failedEmails,
            });
        }
        res.status(200).send({ message: "All emails sent successfully!" });
    } catch (error) {
        console.error("Error sending emails:", error);
        res.status(500).send({ message: "Error sending emails", error });
    }
});

module.exports = router;
