const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const BlogPost = require('../models/BlogPost');
const { authenticate, refreshToken } = require('../middleware/authMiddleware');

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/blog-images');
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  }
});
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type'), false);
  }
});

// Serve uploaded images statically
router.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// Create a new blog post (protected)
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

// Get all published blog posts with filtering and pagination
router.get('/blog-posts', async (req, res) => {
  try {
    const posts = await BlogPost.find({ status: 'published' })
      .populate('author', 'username')
      .sort({ createdAt: -1 });

    res.json({
      posts: posts.map(post => ({
        _id: post._id,
        title: post.title,
        slug: post.slug,
        content: post.content.substring(0, 200) + '...',
        coverImage: post.coverImage,
        author: post.author.username,
        category: post.category,
        readTime: post.readTime,
        createdAt: post.createdAt
      }))
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching posts' });
  }
});

// Get a single blog post by ID or slug
router.get('/blog-posts/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    const post = await BlogPost.findOne({
      $or: [ { _id: identifier }, { slug: identifier } ],
      status: 'published'
    })
    .populate('author', 'username')
    .populate('comments.user', 'username');

    if (!post) return res.status(404).json({ message: 'Post not found' });

    post.views += 1;
    await post.save();

    res.json(post);
  } catch (error) {
    console.error('Error fetching blog post:', error);
    res.status(500).json({ message: 'Error fetching blog post' });
  }
});

module.exports = router;
