// src/components/other-pages/subscriptionService.jsx
import axios from 'axios';

// Create a pre-configured Axios instance
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'https://vedive.com:3000/api',
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

// Create a subscription order
const createOrder = async ({ planId }) => {
  // The server will pull userId from req.user
  return api.post('/subscription/createOrder', { planId });
};

// Verify a payment after returning from Cashfree
const verifyPayment = async (orderId) => {
  return api.get(`/subscription/verifyPayment/${orderId}`);
};

// Fetch current subscription status
const getSubscriptionStatus = async () => {
  return api.get('/subscription/status');
};

export default {
  createOrder,
  verifyPayment,
  getSubscriptionStatus,
};
