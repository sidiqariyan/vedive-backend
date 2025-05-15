const express = require("express");
const Post = require("../models/Post");
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

// Storage for main post image
const postStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/post-images');
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  }
});

// Storage for template images
const templateStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/template-images');
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  }
});

// Multer upload configurations
const uploadPost = multer({
  storage: postStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type'), false);
  }
});

const uploadTemplate = multer({
  storage: templateStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type'), false);
  }
});

// Combined upload middleware for multiple fields
const uploadMiddleware = uploadPost.fields([
  { name: 'image', maxCount: 1 },
  { name: 'templateImages', maxCount: 10 }
]);

// POST route to handle multiple image uploads
router.post("/", uploadMiddleware, async (req, res) => {
  try {
    const { name, description, tags, category, htmlContent } = req.body;
    
    // Validate request
    if (!name || !description || !category || !htmlContent) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Process main image
    const postImage = req.files?.image?.[0];
    const templateImages = req.files?.templateImages || [];

    // Build image paths
    const templateImagePaths = templateImages.map(file => 
      `https://vedive.com:3000/uploads/post-images/${file.filename}`
    );

    // Replace placeholders in HTML
    let processedHtml = htmlContent;
    templateImagePaths.forEach((path, index) => {
      const placeholder = `{{TEMPLATE_IMAGE_${index + 1}}}`;
      processedHtml = processedHtml.replace(placeholder, path);
    });

    // Build post data
    const postData = {
      name,
      description,
      category,
      htmlContent: processedHtml,
      tags: tags ? (typeof tags === 'string' ? tags.split(',').map(tag => tag.trim()) : tags) : [],
      image: postImage ? `/uploads/post-images/${postImage.filename}` : null,
      templateImages: templateImagePaths
    };

    // Save to database
    const newPost = new Post(postData);
    await newPost.save();
    
    res.status(201).json(newPost);

  } catch (error) {
    console.error("Error creating post:", error);
    
    // Handle specific multer errors
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: "File too large (max 5MB)" });
    }
    
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({ 
      error: "Failed to create post", 
      details: error.message 
    });
  }
});

// Get all posts
router.get("/", async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 });
    res.status(200).json(posts);
  } catch (error) {
    console.error("Error fetching posts:", error);
    res.status(500).json({ error: "Failed to fetch posts" });
  }
});

// Update post HTML content
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { htmlContent } = req.body;
    
    if (!htmlContent) {
      return res.status(400).json({ error: "HTML content required" });
    }

    const updatedPost = await Post.findByIdAndUpdate(
      id,
      { htmlContent },
      { new: true, runValidators: true }
    );

    if (!updatedPost) {
      return res.status(404).json({ error: "Post not found" });
    }

    res.status(200).json(updatedPost);
  } catch (error) {
    console.error("Error updating post:", error);
    res.status(500).json({ error: "Failed to update post" });
  }
});

// Optional: Add endpoint to get template images
router.get("/template-images", (req, res) => {
  try {
    const templateDir = path.join(__dirname, '../public/uploads/template-images');
    fs.readdir(templateDir, (err, files) => {
      if (err) return res.status(500).json({ error: "Failed to read template images" });
      res.status(200).json(files.map(file => `/uploads/template-images/${file}`));
    });
  } catch (error) {
    console.error("Error fetching template images:", error);
    res.status(500).json({ error: "Failed to fetch template images" });
  }
});

module.exports = router;