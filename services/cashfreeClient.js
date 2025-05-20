const axios = require('axios');
// const { cashfreeAppId, cashfreeSecretKey } = require('../config/secret');
const cashfreeAppId = "92091559e09e1ef5eb102b66b4519029";
const cashfreeSecretKey = "cfsk_ma_prod_952ee152bb1a344252f96a977558f926_f8ec5951";
// Define Cashfree API base URL
// For production use: https://api.cashfree.com/pg
// For sandbox/testing use: https://sandbox.cashfree.com/pg
const cashfreeApiBaseUrl = 'https://api.cashfree.com/pg';

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
    
    // Format the request body according to Cashfree API requirements
    const requestBody = {
      order_id: orderData.orderId,
      order_amount: orderData.amount,
      order_currency: orderData.currency || 'INR',
      customer_details: {
        customer_id: orderData.customer.id,
        customer_name: orderData.customer.name || undefined,
        customer_email: orderData.customer.email || undefined,
        customer_phone: "9999999999"
      }
    };
    
    // Add optional fields if they exist
    if (orderData.returnUrl || orderData.notifyUrl) {
      requestBody.order_meta = {};
      
      if (orderData.returnUrl) {
        requestBody.order_meta.return_url = orderData.returnUrl;
      }
      
      if (orderData.notifyUrl) {
        requestBody.order_meta.notify_url = orderData.notifyUrl;
      }
    }
    
    // Add order notes if provided
    if (orderData.orderNote) {
      requestBody.order_note = orderData.orderNote;
    }
    
    // Add order tags if provided
    if (orderData.orderTags) {
      requestBody.order_tags = orderData.orderTags;
    }
    
    console.log('Cashfree request payload:', JSON.stringify(requestBody, null, 2));
    
    const response = await axios.post(
      `${cashfreeApiBaseUrl}/orders`,
      requestBody,
      {
        headers: {
          'x-client-id': cashfreeAppId,
          'x-client-secret': cashfreeSecretKey,
          'x-api-version': '2022-09-01', // Required version header
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('Cashfree API response:', JSON.stringify(response.data, null, 2));
    
    // Handle response format according to documentation
    if (!response.data || response.data.order_status !== 'ACTIVE') {
      const errorMsg = response.data?.message || 'Order creation failed';
      throw new Error(errorMsg);
    }
    
    return {
      order_id: response.data.order_id,
      cf_order_id: response.data.cf_order_id,
      payment_session_id: response.data.payment_session_id,
      payment_link: `${cashfreeApiBaseUrl}/orders/pay/${response.data.payment_session_id}`,
      order_status: response.data.order_status
    };
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
          'x-client-secret': cashfreeSecretKey,
          'x-api-version': '2022-09-01' // Required version header
        }
      }
    );
    
    console.log('Cashfree getOrder response:', JSON.stringify(response.data, null, 2));
    
    // Return the complete response data
    return response.data;
  } catch (error) {
    console.error('Cashfree getOrder error:', error.message);
    if (error.response && error.response.data) {
      console.error('Error response data:', JSON.stringify(error.response.data, null, 2));
      throw new Error(error.response.data.message || JSON.stringify(error.response.data));
    }
    throw error;
  }
}

module.exports = {
  createOrder,
  getOrder
};
