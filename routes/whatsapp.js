const WebSocket = require("ws");
const qrcode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");

const MAX_MESSAGE_DELAY_MS = 2000;

function initializeWhatsappClient(wss) {
  const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ["--no-sandbox", "--disable-setuid-sandbox"], headless: true },
    takeoverOnConflict: true,
    restartOnAuthFail: true,
  });

  client.on("qr", (qr) => {
    qrcode.toDataURL(qr, (err, url) => {
      wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "whatsapp_qr", data: url }));
        }
      });
    });
  });

  client.on("ready", () => {
    console.log("WhatsApp Client ready");
    broadcastStatus(wss, "WhatsApp Client ready");
  });

  client.on("disconnected", (reason) => {
    console.log("WhatsApp Client disconnected:", reason);
    broadcastStatus(wss, "Disconnected. Reinitializing...");
    client.initialize();
  });

  client.initialize();
}

function broadcastStatus(wss, message) {
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "status_update", data: message }));
    }
  });
}

module.exports = { initializeWhatsappClient };
