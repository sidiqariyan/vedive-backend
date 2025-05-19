require('dotenv').config();

module.exports = {
  app_id: process.env.CASHFREE_APP_ID,
  secret_key: process.env.CASHFREE_SECRET_KEY,
  // Default to production for production-level integration
  environment: process.env.CASHFREE_ENV || 'PROD',
  frontend_url: process.env.FRONTEND_URL,
  notify_url: process.env.CASHFREE_NOTIFY_URL,
};

