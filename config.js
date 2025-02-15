require("dotenv").config();

module.exports = {
  PORT: process.env.PORT || 3000, // Default to port 3000 if PORT is not set
  MAX_MESSAGE_DELAY_MS: 2000,
  JWT_SECRET: process.env.JWT_SECRET,
  EMAIL_USER: process.env.EMAIL_USER,
  EMAIL_PASS: process.env.EMAIL_PASS,
};