const mongoose = require('mongoose');
const slugify = require('slugify');

const blogPostSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  slug: {
    type: String,
    unique: true,
    sparse: true
  },
  content: {
    type: String,
    required: true,
    trim: true
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  category: {
    type: String,
    enum: ['Technology', 'Business', 'Lifestyle', 'Other'],
    default: 'Other'
  },
  tags: [{
    type: String,
    trim: true
  }],
  coverImage: {
    type: String,
    default: null
  },
  readTime: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['draft', 'published'],
    default: 'draft'
  },
  views: {
    type: Number,
    default: 0
  },
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  comments: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    text: {
      type: String,
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

// Pre-save hook to calculate read time
blogPostSchema.pre('save', function(next) {
  const wordsPerMinute = 200;
  const wordCount = this.content.trim().split(/\s+/).length;
  this.readTime = Math.ceil(wordCount / wordsPerMinute);
  next();
});

// Pre-save hook to generate a unique slug from the title
blogPostSchema.pre('save', async function(next) {
  if (this.isModified('title') || !this.slug) {
    // Generate initial slug
    let potentialSlug = slugify(this.title, { lower: true, strict: true });
    let slugToCheck = potentialSlug;
    let suffix = 1;

    // Check if the slug already exists
    const BlogPost = mongoose.model('BlogPost', blogPostSchema);
    let slugExists = await BlogPost.findOne({ slug: slugToCheck });

    // If duplicate exists and it's not the current document, append a suffix
    while (slugExists && slugExists._id.toString() !== this._id.toString()) {
      slugToCheck = `${potentialSlug}-${suffix}`;
      slugExists = await BlogPost.findOne({ slug: slugToCheck });
      suffix++;
    }
    this.slug = slugToCheck;
  }
  next();
});

module.exports = mongoose.model('BlogPost', blogPostSchema);
