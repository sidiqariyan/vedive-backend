// routes/blogRoute.js
const express      = require('express');
const router       = express.Router();
const multer       = require('multer');
const path         = require('path');
const { v4: uuidv4 } = require('uuid');
const BlogPost     = require('../models/BlogPost');
const { authenticate, refreshToken } = require('../middleware/authMiddleware');

// multer setup (unchanged)
const storage = multer.diskStorage({ … });
const upload  = multer({ storage, limits: { fileSize: 5*1024*1024 }, fileFilter: … });

// Serve uploads
router.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// Create a new blog post (protected + refresh)
router.post(
  '/create-blog-post',
  authenticate,                // ← verify & attach req.user
  refreshToken,                // ← optionally issue X-New-Token
  upload.single('coverImage'), // ← then handle file upload
  async (req, res) => {
    try {
      let { title, content, category, tags } = req.body;
      category = category && category !== 'undefined' ? category : 'Other';
      const slug   = title.toLowerCase()
                          .replace(/[^a-z0-9]+/g,'-')
                          .replace(/^-+|-+$/g,'');
      const tagArray = tags ? tags.split(',').map(t=>t.trim()) : [];
      const newPost = new BlogPost({
        title,
        content,
        slug,
        author: req.user._id,              // ← now defined
        category,
        tags: tagArray,
        status: 'published',
        coverImage: req.file ? `/uploads/blog-images/${req.file.filename}` : null
      });
      await newPost.save();
      res.status(201).json(newPost);
    } catch (err) {
      console.error('Error creating blog post:', err);
      res.status(500).json({ message: 'Error creating blog post' });
    }
  }
);

// … other routes …
module.exports = router;
