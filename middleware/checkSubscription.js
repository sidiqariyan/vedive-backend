const checkSubscription = async (req, res, next) => {
    try {
      // Extract the user from the request object (usually added by authMiddleware)
      const { user } = req;
  
      if (!user) {
        return res.status(401).json({ error: "User not authenticated." });
      }
  
      // Check if the user has an active subscription
      const { subscription } = user;
  
      if (!subscription || !subscription.isActive) {
        return res.status(403).json({
          error: "You need an active subscription to access this feature.",
        });
      }
  
      // Optionally, check if the subscription has expired
      const currentDate = new Date();
      const subscriptionEndDate = new Date(subscription.endDate);
  
      if (currentDate > subscriptionEndDate) {
        return res.status(403).json({
          error: "Your subscription has expired. Please renew your subscription.",
        });
      }
  
      // If the subscription is valid, proceed to the next middleware/route handler
      next();
    } catch (error) {
      console.error("Error in checkSubscription middleware:", error.message);
      res.status(500).json({ error: "Internal server error." });
    }
  };
  
  export default checkSubscription;