const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/authMiddleware");

// Import your models (template posts and blog posts)
const Post = require("../models/Post");       // Your template post model
const BlogPost = require("../models/BlogPost"); // Your blog post model

// Helper middleware to restrict access to admins only
function adminOnly(req, res, next) {
  if (req.user && req.user.role === "admin") {
    return next();
  }
  return res.status(403).json({ error: "Forbidden: Admins only" });
}

/* ************************************
   Template Post Endpoints (using Post)
*************************************** */

// Create a new template post
router.post("/template-post", authenticate, adminOnly, async (req, res) => {
  try {
    const { name, description, tags, category, htmlContent } = req.body;
    if (!name || !description || !category || !htmlContent) {
      return res.status(400).json({ error: "Name, description, category and HTML content are required" });
    }
    // Create a new template post
    const newPost = new Post({
      name,
      description,
      tags: Array.isArray(tags) ? tags : [],
      category,
      htmlContent,
    });
    await newPost.save();
    res.status(201).json({ message: "Template post created successfully", post: newPost });
  } catch (error) {
    console.error("Error creating template post:", error);
    res.status(500).json({ error: "Error creating template post" });
  }
});

// List all template posts
router.get("/template-posts", authenticate, adminOnly, async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 });
    res.json({ posts });
  } catch (error) {
    console.error("Error fetching template posts:", error);
    res.status(500).json({ error: "Error fetching template posts" });
  }
});

/* ************************************
   Blog Post Endpoints (using BlogPost)
*************************************** */

// Create a new blog post
router.post("/blog-post", authenticate, adminOnly, async (req, res) => {
  try {
    const { title, content, category, tags, coverImage } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: "Title and content are required" });
    }
    // Create a new blog post with the admin's id as the author
    const blogPost = new BlogPost({
      title,
      content,
      author: req.user._id,
      category: category || "Other",
      tags: Array.isArray(tags) ? tags : [],
      coverImage: coverImage || null,
    });
    await blogPost.save();
    res.status(201).json({ message: "Blog post created successfully", blogPost });
  } catch (error) {
    console.error("Error creating blog post:", error);
    res.status(500).json({ error: "Error creating blog post" });
  }
});

// List all blog posts
router.get("/blog-posts", authenticate, adminOnly, async (req, res) => {
  try {
    const blogPosts = await BlogPost.find()
      .sort({ createdAt: -1 })
      .populate("author", "name email");
    res.json({ blogPosts });
  } catch (error) {
    console.error("Error fetching blog posts:", error);
    res.status(500).json({ error: "Error fetching blog posts" });
  }
});

/* ************************************
   Additional Admin Tools Access Endpoint
*************************************** */

router.get("/tools-access", authenticate, adminOnly, (req, res) => {
  res.json({ message: "Admin has access to all tools and functionalities." });
});

module.exports = router;
