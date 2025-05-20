require('dotenv').config();

module.exports = {
  appId: process.env.CASHFREE_APP_ID,
  secretKey: process.env.CASHFREE_SECRET_KEY,
  frontendUrl: process.env.FRONTEND_URL,
  notifyUrl: process.env.CASHFREE_NOTIFY_URL,
  apiBase: 'https://api.cashfree.com/pg',
  apiVersion: '2022-09-01',
};
