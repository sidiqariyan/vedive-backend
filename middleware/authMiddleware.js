const jwt = require("jsonwebtoken");
const User = require("../models/User");

const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    console.log("No token provided in the request.");
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("Decoded token:", decoded);

    if (!decoded._id) {
      console.error("Token payload is missing _id field.");
      return res.status(401).json({ error: "Invalid token payload" });
    }

    const user = await User.findById(decoded._id);
    if (!user) {
      console.error("User not found for decoded token:", decoded._id);
      return res.status(401).json({ error: "Invalid token" });
    }

    console.log("Authenticated user:", user);
    req.user = user;
    next();
  } catch (error) {
    console.error("Token verification failed:", error.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

module.exports = { authenticate };