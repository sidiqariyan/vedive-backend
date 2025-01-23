const express = require("express");
const router = express.Router();
const nodemailer = require("nodemailer");

router.post('/send-gmail', (req, res) => {
    const { gmail, appPassword, from, subject, contacts, body } = req.body;
    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: gmail, pass: appPassword },
    });

    contacts.forEach((contact) => {
        const mailOptions = { from, to: contact, subject, html: body };
        transporter.sendMail(mailOptions, (error) => {
            if (error) console.error(`Failed to send email to ${contact}:`, error);
        });
    });

    res.status(200).send({ message: "Emails sent successfully!" });
});

module.exports = router;