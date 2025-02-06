const express = require("express");
const router = express.Router();
const nodemailer = require("nodemailer");

router.post("/send-gmail", async (req, res) => {
    const { gmail, appPassword, from, subject, contacts, body } = req.body;

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: gmail, pass: appPassword },
    });

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
        const results = await Promise.allSettled(
            contacts.map((contact, index) =>
                new Promise((resolve) =>
                    setTimeout(() => resolve(sendEmail(contact)), index * 2000)
                )
            )
        );

        const failedEmails = results
            .filter((result) => result.status === "rejected")
            .map((result) => result.reason);

        if (failedEmails.length > 0) {
            return res.status(500).send({
                message: "Some emails failed to send.",
                errors: failedEmails,
            });
        }

        res.status(200).send({ message: "All emails sent successfully!" });
    } catch (error) {
        res.status(500).send({ message: "Error sending emails", error });
    }
});

module.exports = router;
