const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const { app_id, secret_key, environment } = require("../config/secret");

const CASHFREE_BASE_URL = environment === 'PROD'
  ? 'https://api.cashfree.com'
  : 'https://sandbox.cashfree.com';

async function newOrderId(req, res) {
  const { email, phone, name, amount, note } = req.body;
  if (!email || !phone || !name || typeof amount !== 'number') {
    return res.status(400).json({ success: false, message: 'Missing or invalid required fields' });
  }
  if (amount <= 0) {
    return res.status(400).json({ success: false, message: 'Amount must be positive' });
  }

  const orderId = `ORID-${uuidv4()}`;
  const customerId = `CID-${uuidv4()}`;

  try {
    const response = await axios.post(
      `https://api.cashfree.com/pg/orders`,
      {
        customer_details: { customer_id: customerId, customer_email: email, customer_phone: phone, customer_name: name },
        order_meta: { notify_url: process.env.CASHFREE_NOTIFY_URL, payment_methods: 'cc,dc,upi' },
        order_amount: amount,
        order_id: orderId,
        order_currency: 'INR',
        order_note: note || 'Order from API',
      },
      {
        headers: {
          accept: 'application/json',
          'x-api-version': '2022-09-01',
          'content-type': 'application/json',
          'x-client-id': app_id,
          'x-client-secret': secret_key,
        },
      }
    );

    const data = response.data;
    return res.status(200).json({ success: true, orderId, paymentSessionId: data.payment_session_id, data });
  } catch (error) {
    console.error('Error in newOrderId:', error.response?.data || error.message);
    return res.status(500).json({ success: false, message: error.response?.data?.message || 'Payment initialization failed' });
  }
}

async function checkStatus(req, res) {
  const { orderid } = req.params;
  if (!orderid) {
    return res.status(400).json({ success: false, message: 'Order ID is required' });
  }

  try {
    const response = await axios.get(
      `${CASHFREE_BASE_URL}/pg/orders/${encodeURIComponent(orderid)}`,
      {
        headers: {
          accept: 'application/json',
          'x-api-version': '2022-09-01',
          'x-client-id': app_id,
          'x-client-secret': secret_key,
        },
      }
    );
    const data = response.data;
    return res.status(200).json({ success: true, orderStatus: data.order_status, paymentSessionId: data.payment_session_id, data });
  } catch (error) {
    console.error('Error in checkStatus:', error.response?.data || error.message);
    return res.status(500).json({ success: false, message: error.response?.data?.message || 'Unable to fetch status' });
  }
}

module.exports = { newOrderId, checkStatus };
