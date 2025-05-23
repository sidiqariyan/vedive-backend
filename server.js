const axios = require('axios');

// Define environment and base URL
const environment = process.env.CASHFREE_ENV || 'PRODUCTION'; // Use 'PRODUCTION' for live
const baseUrl ='https://api.cashfree.com';
const apiVersion = '2023-08-01'; // Adjust if a different version is needed

// Subscription route handler
router.post('/subscribe', async (req, res) => {
  const { planId } = req.body;

  try {
    // Assuming user is authenticated and available from middleware
    const user = req.user; // Adjust based on your auth setup

    // Define order details (customize as per your app's needs)
    const orderId = `order_${Date.now()}`; // Generate a unique order ID
    const amount = 100.00; // Replace with actual plan amount
    const currency = 'INR'; // Adjust as needed

    const url = `${baseUrl}/pg/orders`;
    const headers = {
      'x-api-version': apiVersion,
      'Content-Type': 'application/json',
      'x-client-id': process.env.CASHFREE_APP_ID,
      'x-client-secret': process.env.CASHFREE_SECRET_KEY,
    };

    const orderData = {
      order_id: orderId,
      order_amount: amount,
      order_currency: currency,
      customer_details: {
        customer_id: user._id.toString(),
        customer_email: user.email,
        customer_phone: user.phone || '',
      },
      order_meta: {
        return_url: `https://vedive.com/payment-callback?order_id=${orderId}`,
      },
    };

    // Make the API request
    const response = await axios.post(url, orderData, { headers });
    const paymentUrl = response.data.payment_link;

    // Proceed with your logic (e.g., save order to DB, send response)
    res.status(200).json({ paymentUrl });
  } catch (error) {
    console.error('Error creating order:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to create order' });
  }
});
