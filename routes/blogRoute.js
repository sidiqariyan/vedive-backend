const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const BlogPost = require('../models/BlogPost');
const { authenticate } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/adminMiddleware'); // Import authorization middleware

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

// Create a new blog post (admin only)
router.post(
  '/create-blog-post',
  authenticate,              // ensure user is authenticated
  authorizeRoles('admin'),   // ensure user is an admin
  upload.single('coverImage'),
  async (req, res) => {
    try {
      let { title, content, category, tags, authorName } = req.body;
      
      // Use the authenticated user's info if available
      authorName = req.user.name || req.user.email || 'Anonymous';
      
      category = category && category !== 'undefined' ? category : 'Other';
      
      const slug = title.toLowerCase()
                        .replace(/[^a-z0-9]+/g,'-')
                        .replace(/^-+|-+$/g,'');
      
      const tagArray = tags ? tags.split(',').map(t => t.trim()) : [];
      
      const newPost = new BlogPost({
        title,
        content,
        slug,
        authorName,
        userId: req.user._id, // Store the user ID who created the post
        category,
        tags: tagArray,
        status: 'published',
        coverImage: req.file ? `/uploads/blog-images/${req.file.filename}` : null
      });
      
      await newPost.save();
      res.status(201).json(newPost);
    } catch (err) {
      console.error('Error creating blog post:', err);
      res.status(500).json({ message: 'Error creating blog post', error: err.message });
    }
  }
);

// Public routes - no authentication required

// Get all published blog posts
router.get('/blog-posts', async (req, res) => {
  try {
    const posts = await BlogPost.find({ status: 'published' })
      .sort({ createdAt: -1 });
    
    res.json({
      posts: posts.map(post => ({
        id: post._id,
        title: post.title,
        slug: post.slug,
        content: post.content.substring(0, 200) + '...',
        coverImage: post.coverImage,
        authorName: post.authorName,
        category: post.category,
        readTime: post.readTime,
        createdAt: post.createdAt
      }))
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching posts', error: error.message });
  }
});

// Get a single blog post by ID or slug
router.get('/blog-posts/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    
    // First, try to find by slug
    let post = await BlogPost.findOne({ 
      slug: identifier,
      status: 'published' 
    });
    
    // If not found by slug, try to find by ID
    if (!post) {
      try {
        post = await BlogPost.findOne({ 
          _id: identifier,
          status: 'published' 
        });
      } catch (idError) {
        console.log('Error when searching by ID:', idError.message);
      }
    }
    
    if (!post) return res.status(404).json({ message: 'Post not found' });
    
    post.views += 1;
    await post.save();
    
    res.json(post);
  } catch (error) {
    console.error('Error fetching blog post:', error);
    res.status(500).json({ message: 'Error fetching blog post', error: error.message });
  }
});

module.exports = router;
