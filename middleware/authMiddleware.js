const jwt = require("jsonwebtoken");
const User = require("../models/User");

/**
 * Authenticate Middleware with enhanced debugging
 * Verifies the JWT token and attaches the authenticated user to the request object.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware function
 */
const authenticate = async (req, res, next) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      console.log("DEBUG: Authorization header missing");
      return res.status(401).json({ error: "Authorization header missing" });
    }
    
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.substring(7)
      : authHeader;
    
    // Log masked token for debugging (only showing first few chars)
    console.log(`DEBUG: Token received (masked): ${token.substring(0, 10)}...`);
   
    // Check if token exists
    if (!token) {
      console.log("DEBUG: No token provided after parsing header");
      return res.status(401).json({ error: "No token provided" });
    }
    
    // Ensure JWT_SECRET exists and log status
    if (!process.env.JWT_SECRET) {
      console.error("DEBUG: JWT_SECRET is not defined in environment variables");
      return res.status(500).json({ error: "Server configuration error" });
    }
    
    console.log(`DEBUG: JWT_SECRET exists: ${!!process.env.JWT_SECRET}`);
    console.log(`DEBUG: JWT_SECRET length: ${process.env.JWT_SECRET.length}`);
    
    // Add a try-catch specifically for the verify step to get more details
    try {
      // Verify the token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log("DEBUG: Token verified successfully");
      
      // Ensure the token contains a valid user ID
      if (!decoded._id) {
        console.log("DEBUG: Invalid token payload - missing _id");
        return res.status(401).json({ error: "Invalid token payload" });
      }
      
      console.log(`DEBUG: User ID from token: ${decoded._id}`);
     
      // Find the user in the database
      const user = await User.findById(decoded._id);
      if (!user) {
        console.log(`DEBUG: User not found for ID: ${decoded._id}`);
        return res.status(401).json({ error: "User not found" });
      }
      
      console.log(`DEBUG: User found: ${user._id}`);
     
      // Add token expiration check
      const currentTime = Math.floor(Date.now() / 1000);
      const timeToExpire = decoded.exp - currentTime;
      
      console.log(`DEBUG: Token expires in ${timeToExpire} seconds`);
     
      // If token expires in less than 5 minutes, add refresh flag
      if (decoded.exp && timeToExpire < 300 && timeToExpire > 0) {
        req.tokenExpiring = true;
        console.log("DEBUG: Token marked as expiring soon");
      }
     
      // If token is already expired
      if (decoded.exp && currentTime >= decoded.exp) {
        console.log("DEBUG: Token already expired");
        return res.status(401).json({ error: "Token expired. Please log in again." });
      }
     
      // Attach the user object to the request
      req.user = user;
      
      console.log("DEBUG: Authentication successful");
      next();
    } catch (verifyError) {
      console.error("DEBUG: JWT verification failed with error:", verifyError);
      throw verifyError; // Re-throw to be caught by outer catch
    }
  } catch (error) {
    console.error("Authentication Error:", error);
    console.error("Error name:", error.name);
    console.error("Error message:", error.message);
   
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: "Invalid token" });
    }
    else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: "Token expired. Please log in again." });
    }
   
    return res.status(401).json({ error: "Authentication failed" });
  }
};

/**
 * Refresh Token Middleware
 * Attaches a new token to the response if the current token is about to expire
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware function
 */
const refreshToken = (req, res, next) => {
  // If token is about to expire, generate a new one
  if (req.tokenExpiring && req.user) {
    console.log("DEBUG: Generating refresh token");
    const newToken = jwt.sign(
      { _id: req.user._id },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );
   
    // Attach token to response headers
    res.setHeader('X-New-Token', newToken);
    console.log("DEBUG: New token generated and attached to response");
  }
 
  next();
};

module.exports = { authenticate, refreshToken };