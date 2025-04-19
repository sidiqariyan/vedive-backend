import axios from 'axios';

// Create a pre-configured Axios instance
const api = axios.create({
  baseURL: 'https://vedive.com:3000/api',
  withCredentials: true,
});

// Request interceptor to attach JWT
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

/**
 * Extract userId from JWT token
 * @returns {string|null} The user ID from the token or null if not available
 */
const getUserIdFromToken = () => {
  const token = localStorage.getItem('token');
  if (!token) return null;
  
  try {
    // Extract the payload part of the JWT (the middle part)
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(window.atob(base64));
    return payload._id || payload.userId || payload.sub;
  } catch (e) {
    console.error('Error parsing JWT token:', e);
    return null;
  }
};

/**
 * Create a subscription order
 * @param {{ planId: string, amount?: number }} orderData
 */
const createOrder = async (orderData) => {
  // Add userId to the request
  const userId = localStorage.getItem('userId') || getUserIdFromToken();
  
  if (!userId) {
    throw new Error('User ID not available. Please log in again.');
  }
  
  return api.post('/subscription/createOrder', {
    ...orderData,
    userId
  });
};

/**
 * Verify a subscription payment
 * @param {string} orderId
 */
const verifyPayment = async (orderId) => {
  const userId = localStorage.getItem('userId') || getUserIdFromToken();
  
  // Include userId as a query parameter for verification
  return api.get(`/subscription/verifyPayment/${orderId}?userId=${userId}`);
};

/**
 * Get current subscription status
 */
const getSubscriptionStatus = async () => {
  return api.get('/subscription/status');
};

export default {
  createOrder,
  verifyPayment,
  getSubscriptionStatus,
};
