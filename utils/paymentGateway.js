const axios = require("axios");
const crypto = require("crypto");
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
    // Ensure Cashfree credentials are set
    const clientId = process.env.CASHFREE_APP_ID;
    const clientSecret = process.env.CASHFREE_SECRET_KEY;
    const environment = process.env.CASHFREE_ENV || "TEST"; // "PROD" for production

    if (!clientId || !clientSecret) {
      console.error("Cashfree credentials are missing in .env file");
      throw new Error("Missing Cashfree credentials");
    }

    // Base URL for Cashfree API (Sandbox vs Production)
    const CASHFREE_BASE_URL = environment === "PROD"
      ? "https://api.cashfree.com"
      : "https://sandbox.cashfree.com";

    // Prepare request payload
    const requestData = {
      order_id: orderId,
      order_amount: amount,
      order_currency: currency,
      customer_details: {
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
      },
      order_meta: {
        return_url: `${process.env.CLIENT_URL}/payment-success?order_id=${orderId}`,
        notify_url: `${process.env.CLIENT_URL}/payment-notification`,
      },
    };

    // Generate signature
    const signature = generateSignature(requestData, clientSecret);
    requestData.signature = signature;

    // Send request to Cashfree
    const response = await axios.post(
      "https://test.cashfree.com/api/v2/cftoken/order", // Use "api.cashfree.com" for live mode
      requestData,
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-version": "2022-09-01",
          "x-client-id": clientId,  // Ensure correct key name
          "x-client-secret": clientSecret, // Ensure correct key name
        },
      }
    );
    
    

    // Check if the response indicates success
    if (response.data.status !== "ACTIVE") {
      console.error("Cashfree Payment Response:", response.data);
      throw new Error(response.data.message || "Payment processing failed");
    }

    // Return the payment response
    return response.data;
  } catch (error) {
    console.error("Cashfree Payment Error:", error.response?.data || error.message);
    throw new Error(error.response?.data?.message || "Payment processing failed");
  }
};

module.exports = { processPayment };
