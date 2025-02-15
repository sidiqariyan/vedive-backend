const mongoose = require('mongoose');

// Define Post Schema
const postSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    description: {
        type: String,
        required: true,
    },
    tags: {
        type: [String],
        default: [],
    },
    category: {
        type: String,
        required: true,
    },
    htmlContent: {
        type: String,
        required: true,
    },
}, { timestamps: true });

module.exports = mongoose.model('Post', postSchema);