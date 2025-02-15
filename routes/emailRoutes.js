const express = require("express");
const multer = require("multer");
const nodemailer = require("nodemailer");
const fs = require("fs");

const router = express.Router();

// File upload setup
const storage = multer.diskStorage({
  destination: "./uploads/",
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

router.post(
  "/send-bulk-mail",
  upload.fields([{ name: "recipientsFile", maxCount: 1 }, { name: "htmlTemplate", maxCount: 1 }]),
  async (req, res) => {
    const results = { success: [], failures: [] };
    let transporter;

    try {
      const requiredFields = ["smtpHost", "smtpPort", "smtpUsername", "smtpPassword", "fromEmail", "emailSubject"];
      const missing = requiredFields.filter((field) => !req.body[field]);
      if (missing.length > 0) {
        return res.status(400).json({
          error: "Missing required fields",
          missing,
        });
      }

      const recipientsFile = req.files?.recipientsFile?.[0];
      const htmlTemplateFile = req.files?.htmlTemplate?.[0];
      if (!recipientsFile || !htmlTemplateFile) {
        return res.status(400).json({
          error: "Both recipients file and HTML template are required",
        });
      }

      const recipients = fs.readFileSync(recipientsFile.path, "utf-8")
        .split(/\r?\n/)
        .map((email) => email.trim())
        .filter((email) => email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/));

      if (recipients.length === 0) {
        return res.status(400).json({ error: "No valid email addresses found" });
      }

      transporter = nodemailer.createTransport({
        host: req.body.smtpHost,
        port: parseInt(req.body.smtpPort),
        secure: req.body.smtpPort === "465",
        auth: {
          user: req.body.smtpUsername,
          pass: req.body.smtpPassword,
        },
      });

      await transporter.verify();

      const htmlContent = fs.readFileSync(htmlTemplateFile.path, "utf-8");

      for (const recipient of recipients) {
        try {
          await transporter.sendMail({
            from: `"${req.body.fromEmail}" <${req.body.smtpUsername}>`,
            to: recipient,
            subject: req.body.emailSubject,
            html: htmlContent,
          });
          results.success.push(recipient);
          console.log(`Email sent to ${recipient}`);
        } catch (error) {
          results.failures.push({
            recipient,
            error: error.message,
          });
          console.error(`Failed to send to ${recipient}:`, error.message);
        }
      }

      res.json({
        success: results.failures.length === 0,
        sent: results.success.length,
        failed: results.failures,
      });
    } catch (error) {
      console.error("Email send error:", error);
      res.status(500).json({
        error: "Failed to send emails",
        details: error.message,
      });
    } finally {
      if (req.files?.recipientsFile?.[0]?.path) {
        fs.unlinkSync(req.files.recipientsFile[0].path);
      }
      if (req.files?.htmlTemplate?.[0]?.path) {
        fs.unlinkSync(req.files.htmlTemplate[0].path);
      }
      if (transporter) transporter.close();
    }
  }
);

module.exports = router;