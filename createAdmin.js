/**
 * Script to create an initial admin user in the database.
 * Usage: node scripts/createAdmin.js --name=AdminName --email=admin@example.com --password=YourPass123
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const argv = require('minimist')(process.argv.slice(2));

const User = require('../models/User');

async function main() {
  const { name, email, password } = argv;
  if (!name || !email || !password) {
    console.error('Error: --name, --email and --password arguments are required');
    process.exit(1);
  }

  // Connect to MongoDB
  await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  // Check if admin already exists
  const existing = await User.findOne({ email });
  if (existing) {
    console.error(`User with email ${email} already exists.`);
    process.exit(1);
  }

  // Hash password
  const salt = await bcrypt.genSalt(10);
  const hashed = await bcrypt.hash(password, salt);

  // Create admin user
  const admin = new User({
    name,
    email,
    password: hashed,
    role: 'admin',
    isPaidUser: true,
    currentPlan: 'Admin',
    subscriptionEndDate: null
  });

  await admin.save();
  console.log(`Admin user created: ${admin._id}`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
