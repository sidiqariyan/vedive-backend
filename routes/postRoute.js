const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const BlogPost = require('../models/BlogPost');
const { authenticate } = require('../middleware/authMiddleware');

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
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'), false);
    }
  }
});

// Create a new blog post
router.post('/create-blog-post', authenticate, upload.single('coverImage'), async (req, res) => {
  try {
    // Destructure values from req.body
    let { title, content, category, tags, status } = req.body;

    // Validate and sanitize enum fields; fall back to defaults if not valid.
    category = category && category !== 'undefined' ? category : 'Other';
    status = status && status !== 'undefined' ? status : 'draft';

    // Process tags into an array, if provided.
    const tagArray = tags ? tags.split(',').map(tag => tag.trim()) : [];

    // Create the new blog post document.
    const newPost = new BlogPost({
      title,
      content,
      author: req.user._id,
      category,
      tags: tagArray,
      status,
      coverImage: req.file ? `/uploads/blog-images/${req.file.filename}` : null
    });

    // Save the document to MongoDB.
    await newPost.save();
    res.status(201).json(newPost);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating blog post' });
  }
});

// Get all published blog posts
router.get('/blog-posts', async (req, res) => {
  try {
    const { page = 1, limit = 10, category, search } = req.query;
    const query = { status: 'published' };

    if (category) query.category = category;
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } }
      ];
    }

    const posts = await BlogPost.find(query)
      .populate('author', 'username')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await BlogPost.countDocuments(query);

    res.json({
      posts,
      totalPages: Math.ceil(total / limit),
      currentPage: page
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching blog posts' });
  }
});

// Get a single blog post by ID
router.get('/blog-posts/:id', async (req, res) => {
  try {
    const post = await BlogPost.findById(req.params.id)
      .populate('author', 'username')
      .populate('comments.user', 'username');

    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    // Increment view count
    post.views += 1;
    await post.save();

    res.json(post);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching blog post' });
  }
});

module.exports = router;
