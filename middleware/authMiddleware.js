const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Middleware to authenticate user using HTTP-only cookies
 */
const authenticate = async (req, res, next) => {
  try {
    // Get token from cookies instead of Authorization header
    const token = req.cookies.auth_token;
    
    if (!token) {
      return res.status(401).json({ 
        error: 'Access denied. No authentication token found.',
        requiresAuth: true 
      });
    }

    try {
      // Verify the token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Find the user
      const user = await User.findById(decoded._id).select('-password');
      
      if (!user) {
        // Clear invalid cookie
        res.clearCookie('auth_token', {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          path: '/'
        });
        return res.status(401).json({ 
          error: 'User not found. Please log in again.',
          requiresAuth: true 
        });
      }

      // Check if user is verified (optional, depending on your requirements)
      if (!user.isVerified) {
        return res.status(401).json({ 
          error: 'Please verify your email address.',
          needsVerification: true,
          email: user.email 
        });
      }

      // Attach user to request object
      req.user = {
        _id: user._id,
        id: user._id, // For backward compatibility
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified
      };
      
      next();
    } catch (jwtError) {
      console.error('JWT Error:', jwtError);
      
      // Clear invalid cookie
      res.clearCookie('auth_token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/'
      });
      
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          error: 'Authentication token has expired. Please log in again.',
          expired: true,
          requiresAuth: true 
        });
      }
      
      if (jwtError.name === 'JsonWebTokenError') {
        return res.status(401).json({ 
          error: 'Invalid authentication token. Please log in again.',
          requiresAuth: true 
        });
      }
      
      return res.status(401).json({ 
        error: 'Authentication failed. Please log in again.',
        requiresAuth: true 
      });
    }
  } catch (error) {
    console.error('Authentication middleware error:', error);
    return res.status(500).json({ 
      error: 'Internal server error during authentication.' 
    });
  }
};

/**
 * Optional authentication middleware - doesn't fail if no token
 * Useful for routes that work for both authenticated and unauthenticated users
 */
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.cookies.auth_token;
    
    if (!token) {
      req.user = null;
      return next();
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded._id).select('-password');
      
      if (user && user.isVerified) {
        req.user = {
          _id: user._id,
          id: user._id,
          name: user.name,
          username: user.username,
          email: user.email,
          role: user.role,
          isVerified: user.isVerified
        };
      } else {
        req.user = null;
      }
    } catch (jwtError) {
      // Clear invalid cookie silently
      res.clearCookie('auth_token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/'
      });
      req.user = null;
    }
    
    next();
  } catch (error) {
    console.error('Optional auth middleware error:', error);
    req.user = null;
    next();
  }
};

/**
 * Role-based authorization middleware
 * Usage: authorize(['admin', 'moderator'])
 */
const authorize = (roles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Access denied. Authentication required.',
        requiresAuth: true 
      });
    }

    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Access denied. Insufficient permissions.',
        requiredRoles: roles,
        userRole: req.user.role 
      });
    }

    next();
  };
};

module.exports = {
  authenticate,
  optionalAuth,
  authorize
};
