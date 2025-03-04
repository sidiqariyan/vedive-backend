/**
 * Helper Function: Generate Expiry Date for Subscription
 * @param {string} billingCycle - The billing cycle ("monthly" or "yearly")
 * @returns {Date} - The calculated subscription end date
 */
const generateSubscriptionEndDate = (billingCycle) => {
    const now = new Date();
    switch (billingCycle) {
      case "monthly":
        return new Date(now.setMonth(now.getMonth() + 1));
      case "yearly":
        return new Date(now.setFullYear(now.getFullYear() + 1));
      default:
        throw new Error("Invalid billing cycle");
    }
  };
  
  module.exports = { generateSubscriptionEndDate };