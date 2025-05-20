const axios = require('axios');
// const { cashfreeAppId, cashfreeSecretKey } = require('../config/secret');
const cashfreeAppId= "92091559e09e1ef5eb102b66b4519029"
  const cashfreeSecretKey = "cfsk_ma_prod_952ee152bb1a344252f96a977558f926_f8ec5951"

// Define Cashfree API base URL - update this with the correct endpoint
const cashfreeApiBaseUrl = 'https://api.cashfree.com/pg/v2';

/**
 * Creates a payment order with Cashfree
 * @param {Object} orderData
 * @param {string} orderData.orderId - Unique order ID
 * @param {number} orderData.amount - Order amount
 * @param {string} orderData.currency - Currency code (e.g., 'INR')
 * @param {Object} orderData.customer - Customer details
 * @param {string} orderData.returnUrl - URL to redirect after payment
 * @param {string} orderData.notifyUrl - Webhook URL for payment notifications
 * @returns {Promise<Object>} Cashfree API response
 */
async function createOrder(orderData) {
  try {
    // Add logging to debug request data
    console.log('Cashfree API Request:', {
      url: `${cashfreeApiBaseUrl}/orders`,
      appId: cashfreeAppId ? 'Present (masked)' : 'Missing',
      secretKey: cashfreeSecretKey ? 'Present (masked)' : 'Missing',
      orderId: orderData.orderId,
      amount: orderData.amount
    });
    
    // Format the request body according to Cashfree API v2 requirements
    const requestBody = {
      order_id: orderData.orderId,
      order_amount: orderData.amount,
      order_currency: orderData.currency,
      customer_details: {
        customer_id: orderData.customer.id,
        customer_name: orderData.customer.name,
        customer_email: orderData.customer.email,
        customer_phone: orderData.customer.phone
      },
      order_meta: {
        return_url: orderData.returnUrl,
        notify_url: orderData.notifyUrl
      }
    };

    const response = await axios.post(
      `${cashfreeApiBaseUrl}/orders`,
      requestBody,
      {
        headers: {
          'x-client-id': cashfreeAppId,
          'x-client-secret': cashfreeSecretKey,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.status !== 'OK') {
      const errorMsg = response.data.message || 'Unknown error from Cashfree';
      throw new Error(errorMsg);
    }

    return response.data.order_status === 'ACTIVE' ? 
      response.data : 
      Promise.reject(new Error('Order creation failed'));
  } catch (error) {
    if (error.response && error.response.data) {
      // Extract detailed error information from Cashfree response
      const errorMessage = error.response.data.message || JSON.stringify(error.response.data);
      throw new Error(errorMessage);
    }
    throw error;
  }
}

/**
 * Get order details from Cashfree
 * @param {string} orderId 
 * @returns {Promise<Object>} Order details
 */
async function getOrder(orderId) {
  try {
    const response = await axios.get(
      `${cashfreeApiBaseUrl}/orders/${orderId}`,
      {
        headers: {
          'x-client-id': cashfreeAppId,
          'x-client-secret': cashfreeSecretKey
        }
      }
    );

    if (response.data.status !== 'OK') {
      throw new Error(response.data.message || 'Failed to get order details');
    }

    return response.data;
  } catch (error) {
    if (error.response && error.response.data) {
      throw new Error(error.response.data.message || JSON.stringify(error.response.data));
    }
    throw error;
  }
}

module.exports = {
  createOrder,
  getOrder
};
