const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const BlogPost = require("../models/BlogPost");
const { authenticate } = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/adminMiddleware");

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

// Serve uploaded images statically under:
//    GET /api/blog/uploads/<...>
// Because later we do `app.use('/api/blog', blogRouter)` in your server entrypoint.
router.use("/uploads", express.static(path.join(__dirname, "../public/uploads")));



/**
 * @route POST /api/blog/upload-image
 * @desc  Uploads a single image (admin only) for use inside Draft.js editor
 *        Returns: { url: "/uploads/blog-images/<filename>" }
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
      // Because `router.use('/uploads', express.static(...))` is mounted,
      // the public URL to fetch this image is:
      //    https://vedive.com:3000/api/blog/uploads/blog-images/<filename>
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
 * @desc Public: List all published posts
 */
router.get("/blog-posts", async (req, res) => {
  try {
    const posts = await BlogPost.find({ status: "published" }).sort({ createdAt: -1 });
    res.json({
      posts: posts.map((p) => ({
        id: p._id,
        title: p.title,
        slug: p.slug,
        content: p.content.substring(0, 200) + "...",
        coverImage: p.coverImage,
        authorName: p.authorName,
        category: p.category,
        readTime: p.readTime,
        createdAt: p.createdAt
      }))
    });
  } catch (err) {
    res.status(500).json({ message: "Error fetching posts", error: err.message });
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
    if (!post) post = await BlogPost.findOne({ _id: identifier, status: "published" });
    if (!post) return res.status(404).json({ message: "Not found" });
    post.views++;
    await post.save();
    res.json(post);
  } catch (err) {
    res.status(500).json({ message: "Error fetching post", error: err.message });
  }
});

module.exports = router;
