const axios = require('axios');
const crypto = require('crypto');
const { app_id, secret_key, environment } = require('../config/secret');

const BASE_URL = environment === 'PROD' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';
const API_VERSION = '2022-09-01';

function generateSignature(data) {
  const sorted = Object.keys(data).sort().map(key => `${key}=${data[key]}`).join('&');
  return crypto.createHmac('sha256', secret_key).update(sorted).digest('hex');
}

function getClient() {
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      'Content-Type': 'application/json',
      'x-api-version': API_VERSION,
      'x-client-id': app_id,
      'x-client-secret': secret_key,
    },
  });
}

async function createOrder({ orderId, amount, currency, customer, returnUrl, notifyUrl }) {
  const payload = { order_id: orderId, order_amount: amount, order_currency: currency, customer_details: customer, order_meta: { return_url: returnUrl, notify_url: notifyUrl } };
  payload.signature = generateSignature({ order_id: payload.order_id, order_amount: payload.order_amount, order_currency: payload.order_currency });
  const client = getClient();
  const res = await client.post('/pg/orders', payload);
  if (res.data.status !== 'ACTIVE') throw new Error(res.data.message);
  return res.data;
}

async function getOrder(orderId) {
  const client = getClient();
  const res = await client.get(`/pg/orders/${encodeURIComponent(order_id)}`);
  return res.data;
}

module.exports = { getCashfreeClient: () => ({ createOrder, getOrder }) };
