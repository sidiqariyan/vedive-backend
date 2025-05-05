const express = require("express");
const Post = require("../models/Post");
const router = express.Router();
const { authenticate } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/adminMiddleware");

// Create a new post (admin only)
router.post(
  "/",
  authenticate,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const { name, description, tags, category, htmlContent } = req.body;
      const newPost = new Post({ name, description, tags, category, htmlContent });
      await newPost.save();
      res.status(201).json(newPost);
    } catch (error) {
      res.status(500).json({ error: "Failed to create post" });
    }
  }
);

// Get all posts (public)
router.get("/", async (req, res) => {
  try {
    const posts = await Post.find();
    res.status(200).json(posts);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch posts" });
  }
});

// Update a post by ID (admin only)
router.put(
  "/:id",
  authenticate,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { htmlContent } = req.body;
      const updatedPost = await Post.findByIdAndUpdate(
        id,
        { htmlContent },
        { new: true }
      );
      res.status(200).json(updatedPost);
    } catch (error) {
      res.status(500).json({ error: "Failed to update post" });
    }
  }
);

module.exports = router;
