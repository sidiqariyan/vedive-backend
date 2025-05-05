// routes/adminRoutes.js
const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/adminMiddleware");
const User = require("../models/User");
const Post = require("../models/Post");

// Admin dashboard overview
router.get(
  "/dashboard",
  authenticate,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const userCount = await User.countDocuments();
      const postCount = await Post.countDocuments();
      res.json({ userCount, postCount });
    } catch (err) {
      res.status(500).json({ error: "Failed to load dashboard" });
    }
  }
);

// Get all users (admin only)
router.get(
  "/users",
  authenticate,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const users = await User.find().select("-password");
      res.json(users);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch users" });
    }
  }
);

// Delete a user by ID (admin only)
router.delete(
  "/users/:id",
  authenticate,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      await User.findByIdAndDelete(req.params.id);
      res.json({ message: "User deleted" });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete user" });
    }
  }
);

// Manage posts (admin only)
router.get(
  "/posts",
  authenticate,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const posts = await Post.find();
      res.json(posts);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch posts" });
    }
  }
);

router.delete(
  "/posts/:id",
  authenticate,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      await Post.findByIdAndDelete(req.params.id);
      res.json({ message: "Post deleted" });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete post" });
    }
  }
);

module.exports = router;
