require('dotenv').config();

module.exports = {
  appId: "92091559e09e1ef5eb102b66b4519029",
  secretKey: "cfsk_ma_prod_952ee152bb1a344252f96a977558f926_f8ec5951",
  frontendUrl: process.env.FRONTEND_URL,
  notifyUrl: process.env.CASHFREE_NOTIFY_URL,
  apiBase: 'https://api.cashfree.com/pg',
  apiVersion: '2022-09-01',
};
