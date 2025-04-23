const mongoose = require('mongoose');

const blogPostSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  content: {
    type: String,
    required: true
  },
  slug: {
    type: String,
    required: true,
    unique: true
  },
  authorName: {
    type: String,
    default: 'Anonymous'
  },
  category: {
    type: String,
    default: 'Other'
  },
  tags: [String],
  status: {
    type: String,
    enum: ['draft', 'published'],
    default: 'published'
  },
  coverImage: {
    type: String
  },
  views: {
    type: Number,
    default: 0
  },
  readTime: {
    type: Number,
    default: 3
  },
  comments: [{
    content: String,
    user: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }]
}, { timestamps: true });

// Calculate read time before saving
blogPostSchema.pre('save', function(next) {
  if (this.isModified('content')) {
    // Average reading speed: 200 words per minute
    const wordCount = this.content.split(/\s+/).length;
    this.readTime = Math.ceil(wordCount / 200);
  }
  next();
});

const BlogPost = mongoose.model('BlogPost', blogPostSchema);

module.exports = BlogPost;
