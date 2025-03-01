const axios = require("axios");
const crypto = require("crypto");

// Load environment variables
require("dotenv").config();

/**
 * Generate Cashfree Signature
 * @param {Object} data - Data object to sign
 * @param {String} secretKey - Cashfree Secret Key
 * @returns {String} - HMAC SHA256 signature
 */
const generateSignature = (data, secretKey) => {
  const sortedData = Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join("&");
  return crypto.createHmac("sha256", secretKey).update(sortedData).digest("hex");
};

/**
 * Process Payment with Cashfree
 * @param {Object} paymentDetails - Details of the payment
 * @param {Number} paymentDetails.amount - Amount to charge
 * @param {String} paymentDetails.currency - Currency (e.g., "INR")
 * @param {String} paymentDetails.orderId - Unique order ID
 * @param {String} paymentDetails.customerName - Customer's name
 * @param {String} paymentDetails.customerEmail - Customer's email
 * @param {String} paymentDetails.customerPhone - Customer's phone number
 * @returns {Promise<Object>} - Payment response from Cashfree
 */
const processPayment = async (paymentDetails) => {
  const {
    amount,
    currency = "INR",
    orderId,
    customerName,
    customerEmail,
    customerPhone,
  } = paymentDetails;

  try {
    // Prepare request payload
    const requestData = {
      appId: process.env.CASHFREE_APP_ID,
      orderId,
      orderAmount: amount,
      orderCurrency: currency,
      customerName,
      customerEmail,
      customerPhone,
      returnUrl: `${process.env.CLIENT_URL}/payment-success`, // Redirect URL after payment
      notifyUrl: `${process.env.CLIENT_URL}/payment-notification`, // Webhook URL for notifications
    };

    // Generate signature
    const signature = generateSignature(requestData, process.env.CASHFREE_SECRET_KEY);
    requestData.signature = signature;

    // Send request to Cashfree
    const response = await axios.post("https://test.cashfree.com/api/v2/cftoken/order", requestData, {
      headers: {
        "Content-Type": "application/json",
        "x-api-version": "2022-09-01", // Use the latest API version
      },
    });

    // Return the payment response
    return response.data;
  } catch (error) {
    console.error("Cashfree Payment Error:", error.response?.data || error.message);
    throw new Error("Payment processing failed");
  }
};

module.exports = { processPayment };