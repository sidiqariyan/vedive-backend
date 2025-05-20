const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

// Try different ways to get the MongoDB URI
let mongoUri;

// Option 1: Try to import from config files typically used in Node.js projects
try {
  // First try from config file
  const config = require('./config/db');
  mongoUri = config.mongoUri;
} catch (e) {
  console.log('Could not find mongoUri from config/db.js, trying alternative locations...');
}

// Option 2: Try in config/secret.js
if (!mongoUri) {
  try {
    const secret = require('./config/secret');
    mongoUri = secret.mongoUri || secret.MONGO_URI;
  } catch (e) {
    console.log('Could not find mongoUri from config/secret.js, trying alternative locations...');
  }
}

// Option 3: Check environment variables
if (!mongoUri) {
  mongoUri = process.env.MONGO_URI || process.env.DB_URI || process.env.MONGODB_URI;
}

// Option 4: Look directly in the server.js file
if (!mongoUri) {
  try {
    const fs = require('fs');
    const serverContent = fs.readFileSync('./server.js', 'utf8');
    const match = serverContent.match(/mongoose\.connect\(['"](.+?)['"]/);
    if (match && match[1]) {
      mongoUri = match[1];
      console.log('Found MongoDB URI in server.js');
    }
  } catch (e) {
    console.log('Could not extract mongoUri from server.js');
  }
}

if (!mongoUri) {
  console.error('Could not find MongoDB URI. Please specify it manually in this script.');
  process.exit(1);
}

console.log(`Using MongoDB URI: ${mongoUri.substring(0, 20)}...`);

// Connect to MongoDB
mongoose.connect(mongoUri)
  .then(() => console.log('Connected to MongoDB for cleanup'))
  .catch(err => {
    console.error('Could not connect to MongoDB:', err);
    process.exit(1);
  });

// Define a simplified version of your Subscription schema for the cleanup
const SubscriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  plan: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, default: null },
  cashfreeOrderId: { type: String }
}, { collection: 'subscriptions' });  // Explicitly specify collection name

// Create a model directly from this schema
const Subscription = mongoose.model('SubscriptionCleanup', SubscriptionSchema);

async function cleanup() {
  try {
    console.log('Starting subscription cleanup...');
    
    // First, check for the problematic index
    const collection = mongoose.connection.db.collection('subscriptions');
    const indexes = await collection.indexes();
    console.log('Current indexes:', JSON.stringify(indexes, null, 2));
    
    // Find problematic index
    const problematicIndex = indexes.find(idx => idx.name === 'orderId_1' || idx.name === 'cashfreeOrderId_1');
    if (problematicIndex) {
      console.log(`Found problematic index "${problematicIndex.name}", dropping it...`);
      try {
        await collection.dropIndex(problematicIndex.name);
        console.log('Index dropped successfully');
      } catch (indexError) {
        console.error('Error dropping index:', indexError);
      }
    }
    
    // Find all subscriptions with null cashfreeOrderId
    const nullSubs = await Subscription.find({ cashfreeOrderId: null });
    console.log(`Found ${nullSubs.length} subscriptions with null cashfreeOrderId`);
    
    if (nullSubs.length > 0) {
      // Option 1: Delete all subscriptions with null cashfreeOrderId
      const deleteResult = await Subscription.deleteMany({ cashfreeOrderId: null });
      console.log(`Deleted ${deleteResult.deletedCount} subscriptions with null cashfreeOrderId`);
      
      /* Option 2: Update all subscriptions with null cashfreeOrderId to have a unique value
      let updatedCount = 0;
      for (const sub of nullSubs) {
        sub.cashfreeOrderId = 'migrated-' + uuidv4();
        await sub.save();
        updatedCount++;
      }
      console.log(`Updated ${updatedCount} subscriptions with unique cashfreeOrderId values`);
      */
    }
    
    // Create a new unique index if needed
    console.log('Creating new unique index on cashfreeOrderId...');
    await collection.createIndex({ cashfreeOrderId: 1 }, { unique: true, sparse: true });
    console.log('New index created successfully');
    
    console.log('Cleanup complete!');
  } catch (error) {
    console.error('Error during cleanup:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the cleanup function
cleanup();
