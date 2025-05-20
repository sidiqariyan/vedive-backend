const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
// Import your MongoDB connection string from your config
const mongoUri = process.env.MONGO_URI || require('./config/secret').mongoUri;

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
});

// Create a model directly from this schema without affecting your main application
const Subscription = mongoose.model('Subscription', SubscriptionSchema, 'subscriptions');

async function cleanup() {
  try {
    console.log('Starting subscription cleanup...');
    
    // Find all subscriptions with null cashfreeOrderId
    const nullSubs = await Subscription.find({ cashfreeOrderId: null });
    console.log(`Found ${nullSubs.length} subscriptions with null cashfreeOrderId`);
    
    if (nullSubs.length === 0) {
      console.log('No subscriptions to clean up. Checking for index issues...');
      
      // Check if the index is named differently than expected
      const collection = mongoose.connection.db.collection('subscriptions');
      const indexes = await collection.indexes();
      console.log('Current indexes:', JSON.stringify(indexes, null, 2));
      
      // Drop the problematic index if it exists
      const problematicIndex = indexes.find(idx => idx.name === 'orderId_1');
      if (problematicIndex) {
        console.log('Found problematic index "orderId_1", dropping it...');
        await collection.dropIndex('orderId_1');
        console.log('Index dropped successfully');
      }
      
      return;
    }
    
    // Option 1: Delete all subscriptions with null cashfreeOrderId
    /*
    const deleteResult = await Subscription.deleteMany({ cashfreeOrderId: null });
    console.log(`Deleted ${deleteResult.deletedCount} subscriptions with null cashfreeOrderId`);
    */
    
    // Option 2: Update all subscriptions with null cashfreeOrderId to have a unique value
    let updatedCount = 0;
    for (const sub of nullSubs) {
      sub.cashfreeOrderId = 'migrated-' + uuidv4();
      await sub.save();
      updatedCount++;
    }
    console.log(`Updated ${updatedCount} subscriptions with unique cashfreeOrderId values`);
    
    console.log('Cleanup complete!');
  } catch (error) {
    console.error('Error during cleanup:', error);
  } finally {
    mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the cleanup function
cleanup();
