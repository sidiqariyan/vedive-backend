const got = require('got');
const { app_id, secret_key, environment } = require('../config/secret');
const crypto = require('crypto');

// Production base URL
const BASE_URL = 'https://api.cashfree.com';
const API_VERSION = '2022-09-01';

function generateSignature(data) {
  const sorted = Object.keys(data)
    .sort()
    .map(key => `${key}=${data[key]}`)
    .join('&');
  return crypto
    .createHmac('sha256', secret_key)
    .update(sorted)
    .digest('hex');
}

const client = got.extend({
  prefixUrl: BASE_URL,
  responseType: 'json',
  headers: {
    'Content-Type': 'application/json',
    'x-api-version': API_VERSION,
    'x-client-id': app_id,
    'x-client-secret': secret_key,
  },
});

module.exports = {
  async createOrder({ orderId, amount, currency, customer, returnUrl, notifyUrl }) {
    const payload = {
      order_id:       orderId,
      order_amount:   amount,
      order_currency: currency,
      customer_details: customer,
      order_meta: {
        return_url: returnUrl,
        notify_url: notifyUrl,
      }
    };
    payload.signature = generateSignature({
      order_id: payload.order_id,
      order_amount: payload.order_amount,
      order_currency: payload.order_currency
    });

    const { body } = await client.post('pg/orders', { json: payload });
    if (body.status !== 'ACTIVE') {
      throw new Error(body.message || 'Cashfree order creation failed');
    }
    return body;
  },

  async getOrder(orderId) {
    const { body } = await client.get(`pg/orders/${encodeURIComponent(orderId)}`);
    return body;
  },
};
