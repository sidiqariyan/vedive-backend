const { MongoClient, ObjectId } = require('mongodb');

const uri = 'mongodb+srv://ferdawsmindmingles:sEmGB69cWJoT4WqN@cluster0.kk2gy.mongodb.net/vedive?retryWrites=true&w=majority'; // Replace with your connection string
const dbName = 'vedive';        

async function fixIndexes() {
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection('whatsappanalytics');

    // 1. Drop the problematic index if it exists
    try {
      await collection.dropIndex('trackingId_1');
      console.log('✅ Dropped index: trackingId_1');
    } catch (err) {
      if (err.codeName === 'IndexNotFound') {
        console.log('ℹ️ Index trackingId_1 not found, skipping drop.');
      } else {
        throw err;
      }
    }

    // 2. Create a new sparse unique index on trackingId
    await collection.createIndex(
      { trackingId: 1 },
      { unique: true, sparse: true, name: 'trackingId_sparse_unique' }
    );
    console.log('✅ Created sparse unique index on trackingId');

    // 3. Create a compound unique index
    await collection.createIndex(
      { campaignId: 1, phoneNumber: 1, messageId: 1 },
      { unique: true, name: 'campaign_phone_message_unique' }
    );
    console.log('✅ Created compound unique index on campaignId, phoneNumber, messageId');

    // 4. Remove duplicates (keep only first document)
    const duplicates = await collection.aggregate([
      {
        $group: {
          _id: {
            campaignId: "$campaignId",
            phoneNumber: "$phoneNumber",
            messageId: "$messageId"
          },
          ids: { $push: "$_id" },
          count: { $sum: 1 }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]).toArray();

    let totalRemoved = 0;

    for (const doc of duplicates) {
      const [keep, ...remove] = doc.ids;
      const result = await collection.deleteMany({ _id: { $in: remove } });
      totalRemoved += result.deletedCount;
    }

    console.log(`✅ Removed ${totalRemoved} duplicate documents`);

  } catch (err) {
    console.error('❌ Error fixing indexes:', err);
  } finally {
    await client.close();
  }
}

fixIndexes();
