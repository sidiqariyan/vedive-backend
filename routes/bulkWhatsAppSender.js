app.post(
  "/upload",
  upload.fields([
    { name: "messageFile" },
    { name: "contactsFile" },
    { name: "mediaFile" },
  ]),
  async (req, res) => {
    try {
      const messageFile = req.files?.messageFile?.[0];
      const contactsFile = req.files?.contactsFile?.[0];
      const mediaFile = req.files?.mediaFile?.[0];

      if (!messageFile || !contactsFile) {
        return res.status(400).send("Message file and contacts file are required.");
      }

      const message = fs.readFileSync(messageFile.path, "utf-8").trim();
      const workbook = xlsx.readFile(contactsFile.path);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const contacts = xlsx.utils.sheet_to_json(sheet);

      let media = null;
      if (mediaFile) {
        const mediaData = fs.readFileSync(mediaFile.path);
        media = new MessageMedia(
          mediaFile.mimetype,
          mediaData.toString("base64"),
          mediaFile.originalname
        );
      }

      for (let contact of contacts) {
        const phoneNumber = contact["phone"]?.trim();
        if (!phoneNumber) continue;

        // Verify if the number is registered on WhatsApp
        const isRegistered = await client.isRegisteredUser(`${phoneNumber}@c.us`);
        if (!isRegistered) {
          console.log(`Number ${phoneNumber} is not registered on WhatsApp.`);
          continue;
        }

        // Personalize message
        const personalizedMessage = `Hi ${contact["name"] || "there"}, ${message}`;

        try {
          await client.sendMessage(`${phoneNumber}@c.us`, personalizedMessage);
          if (media) {
            await client.sendMessage(`${phoneNumber}@c.us`, media, { caption: personalizedMessage });
          }
          console.log(`Message sent to ${phoneNumber}`);
        } catch (error) {
          console.error(`Failed to send message to ${phoneNumber}:`, error);
        }

        // Add a delay to avoid rate limits
        await delay(2000); // 2 seconds
      }

      fs.unlinkSync(messageFile.path);
      fs.unlinkSync(contactsFile.path);
      if (mediaFile) fs.unlinkSync(mediaFile.path);

      res.send("Messages sent!");
    } catch (error) {
      console.error("Error sending messages:", error);
      res.status(500).send(`Error: ${error.message}`);
    }
  }
);