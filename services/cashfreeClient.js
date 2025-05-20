const crypto = require('crypto');
const { apiBase, apiVersion, appId, secretKey } = require('../config/secret');

function generateSignature(data) {
  const payload = Object.keys(data).sort().map(k => `${k}=${data[k]}`).join('&');
  return crypto.createHmac('sha256', secretKey).update(payload).digest('hex');
}

async function createOrder({ orderId, amount, currency, customer, returnUrl, notifyUrl }) {
  const url = `${apiBase}/orders`;
  const payload = {
    order_id: orderId,
    order_amount: amount,
    order_currency: currency,
    customer_details: customer,
    order_meta: { return_url: returnUrl, notify_url: notifyUrl },
  };
  payload.signature = generateSignature({ order_id: orderId, order_amount: amount, order_currency: currency });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-version': apiVersion,
      'x-client-id': appId,
      'x-client-secret': secretKey,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.status !== 'ACTIVE') throw new Error(data.message || 'Cashfree createOrder failed');
  return data;
}

async function getOrder(orderId) {
  const url = `${apiBase}/orders/${encodeURIComponent(orderId)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-api-version': apiVersion,
      'x-client-id': appId,
      'x-client-secret': secretKey,
    }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Cashfree getOrder failed');
  return data;
}

module.exports = { createOrder, getOrder };
