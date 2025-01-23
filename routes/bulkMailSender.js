const express = require('express');
const nodemailer = require("nodemailer");
const router = express.Router();



app.use(express.json());
app.use(express.urlencoded({}));


app.post(
  "/api/send-bulk-mail",
  upload.fields([
    { name: "recipientsFile" },
    { name: "htmlTemplate" }
  ]),
  async (req, res) => {
    try {
      const {
        smtpHost,
        smtpPort,
        smtpUsername,
        smtpPassword,
        fromEmail,
        emailSubject
      } = req.body;

      if (!smtpHost || !smtpPort || !smtpUsername || !smtpPassword || !fromEmail || !emailSubject) {
        return res.status(400).send("Missing required SMTP or email details.");
      }

      const recipientsFile = req.files?.recipientsFile?.[0];
      const htmlTemplateFile = req.files?.htmlTemplate?.[0];

      if (!recipientsFile || !htmlTemplateFile) {
        return res.status(400).send("Recipients file and HTML template file are required.");
      }

      const recipientsData = fs.readFileSync(recipientsFile.path, "utf-8");
      const recipients = recipientsData.split(/\r?\n/).filter((email) => email.trim() !== "");
      const emailBody = fs.readFileSync(htmlTemplateFile.path, "utf-8");

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(smtpPort),
        secure: smtpPort == 465,
        auth: {
          user: smtpUsername,
          pass: smtpPassword,
        },
      });

      for (const recipient of recipients) {
        try {
          await transporter.sendMail({
            from: fromEmail,
            to: recipient,
            subject: emailSubject,
            html: emailBody,
          });
          console.log(`Email sent to ${recipient}`);
        } catch (err) {
          console.error(`Failed to send email to ${recipient}:`, err); // Log the error details
          // Send detailed error message back to frontend
          return res.status(500).send(`Failed to send email to ${recipient}: ${err.message}`);
        }
      }

      fs.unlinkSync(recipientsFile.path);
      fs.unlinkSync(htmlTemplateFile.path);

      res.send("Bulk emails sent successfully!");
    } catch (error) {
      console.error("Error sending bulk emails:", error); // Log the error in the backend
      res.status(500).send(`Error: ${error.message}`);
    }
  }
);