const crypto = require('crypto');
const { app_id, secret_key } = require('../config/secret');

// Production base URL
const BASE_URL = 'https://api.cashfree.com/pg';
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

async function createOrder({ orderId, amount, currency, customer, returnUrl, notifyUrl }) {
  const url = `${BASE_URL}/orders`;
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

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-version': API_VERSION,
      'x-client-id': app_id,
      'x-client-secret': secret_key,
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  if (!response.ok || body.status !== 'ACTIVE') {
    throw new Error(body.message || 'Cashfree order creation failed');
  }
  return body;
}

async function getOrder(orderId) {
  const url = `${BASE_URL}/orders/${encodeURIComponent(orderId)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-api-version': API_VERSION,
      'x-client-id': app_id,
      'x-client-secret': secret_key,
    }
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.message || 'Unable to fetch Cashfree order');
  }
  return body;
}

module.exports = { createOrder, getOrder };
