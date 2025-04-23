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
router.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// Create a new blog post
router.post('/create-blog-post', upload.single('coverImage'), async (req, res) => {
  try {
    // Destructure only the allowed fields from the request body
    let { title, content, category, tags } = req.body;
    
    // Default category to 'Other' if not provided
    category = category && category !== 'undefined' ? category : 'Other';
    
    // Always set status to "published" (ignoring any client input)
    const status = 'published';
    
    // Generate a slug from the title
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    
    const tagArray = tags ? tags.split(',').map(tag => tag.trim()) : [];
    
    const newPost = new BlogPost({
      title,
      content,
      slug, // Add slug generation
      author: req.user._id,
      category,
      tags: tagArray,
      status,
      coverImage: req.file ? `/uploads/blog-images/${req.file.filename}` : null
    });
    
    await newPost.save();
    res.status(201).json(newPost);
  } catch (error) {
    console.error('Error creating blog post:', error);
    res.status(500).json({ message: 'Error creating blog post' });
  }
});

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
      $or: [
        { _id: identifier },
        { slug: identifier }
      ],
      status: 'published' // Ensure only published posts are retrieved
    })
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
    console.error('Error fetching blog post:', error);
    res.status(500).json({ message: 'Error fetching blog post' });
  }
});

module.exports = router;
