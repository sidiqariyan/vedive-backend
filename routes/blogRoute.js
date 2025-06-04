const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const BlogPost = require("../models/BlogPost");
const { authenticate } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/adminMiddleware");
const Comment = require("../models/Comment");

/** 
 * Configure multer for file uploads 
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "public/uploads/blog-images"),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    cb(null, allowed.includes(file.mimetype));
  }
});

// Serve uploaded images statically
router.use("/uploads", express.static(path.join(__dirname, "../public/uploads")));

/**
 * @route POST /api/blog/upload-image
 * @desc  Uploads a single image (admin only) for use inside Draft.js editor
 */
router.post(
  "/upload-image",
  authenticate,
  authorizeRoles("admin"),
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file received." });
      }
      const relativePath = `/uploads/blog-images/${req.file.filename}`;
      return res.status(200).json({ url: relativePath });
    } catch (err) {
      console.error("Upload-image route error:", err);
      return res
        .status(500)
        .json({ message: "Failed to upload image.", error: err.message });
    }
  }
);

/**
 * @route POST /api/blog/create-blog-post
 * @desc Create a new blog post (admin only)
 */
router.post(
  "/create-blog-post",
  authenticate,
  authorizeRoles("admin"),
  upload.single("coverImage"),
  async (req, res) => {
    try {
      let { title, content, category, tags, authorName } = req.body;
      authorName = req.user.name || req.user.email;
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const tagArray = tags ? tags.split(",").map((t) => t.trim()) : [];
      const newPost = new BlogPost({
        title,
        content,
        slug,
        authorName,
        userId: req.user._id,
        category: category || "Other",
        tags: tagArray,
        coverImage: req.file ? `/uploads/blog-images/${req.file.filename}` : null
      });
      await newPost.save();
      res.status(201).json(newPost);
    } catch (err) {
      res.status(500).json({ message: "Error creating post", error: err.message });
    }
  }
);

/**
 * @route PUT /api/blog/update-blog-post/:id
 * @desc Update an existing blog post (admin only)
 */
router.put(
  "/update-blog-post/:id",
  authenticate,
  authorizeRoles("admin"),
  upload.single("coverImage"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const updates = { ...req.body };

      if (updates.title) {
        updates.slug = updates.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
      }

      if (updates.tags) {
        updates.tags = updates.tags.split(",").map((t) => t.trim());
      }

      if (req.file) {
        updates.coverImage = `/uploads/blog-images/${req.file.filename}`;
      }

      const post = await BlogPost.findByIdAndUpdate(id, updates, { new: true });
      if (!post) return res.status(404).json({ message: "Post not found" });

      res.json(post);
    } catch (err) {
      res.status(500).json({ message: "Error updating post", error: err.message });
    }
  }
);

/**
 * @route DELETE /api/blog/delete-blog-post/:id
 * @desc Delete a blog post (admin only)
 */
router.delete(
  "/delete-blog-post/:id",
  authenticate,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const post = await BlogPost.findByIdAndDelete(id);
      if (!post) return res.status(404).json({ message: "Post not found" });
      res.json({ message: "Post deleted successfully" });
    } catch (err) {
      res.status(500).json({ message: "Error deleting post", error: err.message });
    }
  }
);

/**
 * @route GET /api/blog/blog-posts
 * @desc Public: List all published posts with filtering, search, pagination, and sorting
 */
router.get("/blog-posts", async (req, res) => {
  try {
    const { 
      search, 
      category, 
      tag, 
      page = 1, 
      limit = 12, 
      sort = 'newest' 
    } = req.query;
    
    const query = { status: "published" };
    
    // Search functionality
    if (search && search.trim()) {
      query.$or = [
        { title: { $regex: search.trim(), $options: "i" } },
        { content: { $regex: search.trim(), $options: "i" } },
        { authorName: { $regex: search.trim(), $options: "i" } }
      ];
    }
    
    // Category filter
    if (category && category.trim()) {
      query.category = { $regex: category.trim(), $options: "i" };
    }
    
    // Tag filter
    if (tag && tag.trim()) {
      query.tags = { $in: [new RegExp(tag.trim(), "i")] };
    }
    
    // Sorting options
    let sortOption = { createdAt: -1 }; // default: newest first
    switch (sort) {
      case 'oldest':
        sortOption = { createdAt: 1 };
        break;
      case 'popular':
        sortOption = { views: -1, createdAt: -1 };
        break;
      case 'newest':
      default:
        sortOption = { createdAt: -1 };
        break;
    }
    
    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    
    // Get total count for pagination
    const totalCount = await BlogPost.countDocuments(query);
    const totalPages = Math.ceil(totalCount / limitNum);
    
    // Fetch posts
    const posts = await BlogPost.find(query)
      .sort(sortOption)
      .skip(skip)
      .limit(limitNum);
    
    // Format response
    const formattedPosts = posts.map((post) => ({
      id: post._id,
      title: post.title,
      slug: post.slug,
      content: post.content,
      coverImage: post.coverImage,
      authorName: post.authorName,
      category: post.category,
      tags: post.tags || [],
      readTime: post.readTime || `${Math.ceil(post.content.replace(/<[^>]*>/g, '').split(' ').length / 200)} min read`,
      views: post.views || 0,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt
    }));
    
    // Pagination info
    const pagination = {
      currentPage: pageNum,
      totalPages,
      totalCount,
      hasNextPage: pageNum < totalPages,
      hasPrevPage: pageNum > 1,
      limit: limitNum
    };
    
    res.json({
      posts: formattedPosts,
      pagination
    });
    
  } catch (err) {
    console.error("Error fetching blog posts:", err);
    res.status(500).json({ 
      message: "Error fetching posts", 
      error: err.message 
    });
  }
});

/**
 * @route GET /api/blog/categories
 * @desc Public: Get all categories with post counts
 */
router.get("/categories", async (req, res) => {
  try {
    const categories = await BlogPost.aggregate([
      { $match: { status: "published" } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    const formattedCategories = categories.map(cat => ({
      name: cat._id,
      count: cat.count
    }));
    
    res.json({
      categories: formattedCategories
    });
  } catch (err) {
    console.error("Error fetching categories:", err);
    res.status(500).json({ 
      message: "Error fetching categories", 
      error: err.message 
    });
  }
});

/**
 * @route GET /api/blog/tags
 * @desc Public: Get all tags with post counts
 */
router.get("/tags", async (req, res) => {
  try {
    const tags = await BlogPost.aggregate([
      { $match: { status: "published" } },
      { $unwind: "$tags" },
      { $group: { _id: "$tags", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 50 } // Limit to top 50 tags
    ]);
    
    const formattedTags = tags.map(tag => ({
      name: tag._id,
      count: tag.count
    }));
    
    res.json({
      tags: formattedTags
    });
  } catch (err) {
    console.error("Error fetching tags:", err);
    res.status(500).json({ 
      message: "Error fetching tags", 
      error: err.message 
    });
  }
});

/**
 * @route POST /api/blog/comments
 * @desc  Submit a new comment
 */
router.post("/comments", async (req, res) => {
  try {
    const { name, email, website, message, postSlug } = req.body;
    if (!name || !email || !message || !postSlug) {
      return res.status(400).json({ message: "Missing required fields" });
    }
    
    const post = await BlogPost.findOne({ slug: postSlug, status: "published" });
    if (!post) return res.status(404).json({ message: "Post not found" });

    const newComment = new Comment({ name, email, website, message, postSlug });
    await newComment.save();
    res.status(201).json(newComment);
  } catch (err) {
    res.status(500).json({ message: "Error creating comment", error: err.message });
  }
});

/**
 * @route GET /api/blog/comments/:postSlug
 * @desc  Get comments for a specific post
 */
router.get("/comments/:postSlug", async (req, res) => {
  try {
    const { postSlug } = req.params;
    const comments = await Comment.find({ postSlug }).sort({ createdAt: -1 });
    res.json(comments);
  } catch (err) {
    res.status(500).json({ message: "Error fetching comments", error: err.message });
  }
});

/**
 * @route GET /api/blog/blog-posts/:identifier
 * @desc Public: Get single post by slug or ID
 */
router.get("/blog-posts/:identifier", async (req, res) => {
  try {
    const { identifier } = req.params;
    let post = await BlogPost.findOne({ slug: identifier, status: "published" });
    if (!post) {
      post = await BlogPost.findOne({ _id: identifier, status: "published" });
    }
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }
    
    // Increment view count
    post.views = (post.views || 0) + 1;
    await post.save();
    
    res.json(post);
  } catch (err) {
    console.error("Error fetching post:", err);
    res.status(500).json({ 
      message: "Error fetching post", 
      error: err.message 
    });
  }
});

module.exports = router;