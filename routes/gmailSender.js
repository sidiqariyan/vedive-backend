const express = require("express");
const router = express.Router();
const nodemailer = require("nodemailer");
const mongoose = require("mongoose");
const Campaign = require("../models/Campaign"); // Import the Campaign model

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
    const sendEmail = (contact) => {
        return new Promise((resolve, reject) => {
            const mailOptions = { from, to: contact, subject, html: body };
            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error(`Failed to send email to ${contact}:`, error);
                    return reject(error);
                }
                console.log(`Email sent to ${contact}: ${info.response}`);
                resolve(info.response);
            });
        });
    };

    try {
        // Send emails with a delay between each
        const results = await Promise.allSettled(
            contacts.map((contact, index) =>
                new Promise((resolve) =>
                    setTimeout(() => resolve(sendEmail(contact)), index * 2000)
                )
            )
        );

        // Collect failed emails
        const failedEmails = results
            .filter((result) => result.status === "rejected")
            .map((result) => result.reason);

        // Save campaign data to MongoDB
        const newCampaign = new Campaign({
            campaignName,
            toolType: "gmail-sender", // Associate this campaign with the Gmail tool
            smtpHost: "smtp.gmail.com", // Gmail's SMTP host
            smtpPort: 587, // Gmail's SMTP port
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