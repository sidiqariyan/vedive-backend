require("dotenv").config();

const { CASHFREE_APP_ID, CASHFREE_SECRET_KEY, CASHFREE_ENV } = process.env;

if (!CASHFREE_APP_ID || !CASHFREE_SECRET_KEY) {
  throw new Error('Missing Cashfree credentials: set CASHFREE_APP_ID and CASHFREE_SECRET_KEY');
}

module.exports = {
  app_id: CASHFREE_APP_ID,
  secret_key: CASHFREE_SECRET_KEY,
  environment: CASHFREE_ENV || 'PRODUCTION',
};
