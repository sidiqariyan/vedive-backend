#!/usr/bin/env node
/**
 * Script to create an initial admin user in the database.
 * Usage from project root:
 *   node scripts/createAdmin.js --name=Name --username=adminuser --email=you@example.com --password=pass
 * Or if script is at project root:
 *   node createAdmin.js --name=Name --username=adminuser --email=you@example.com --password=pass
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const argv = require('minimist')(process.argv.slice(2));
const path = require('path');

// Load User model, try both scripts/ and root locations
let User;
try {
  User = require(path.join(__dirname, '../models/User'));
} catch (e) {
  User = require(path.join(__dirname, './models/User'));
}

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('Error: MONGO_URI not set in .env');
  process.exit(1);
}

async function main() {
  await mongoose.connect(MONGO_URI);

  const { name, username: inputUsername, email, password } = argv;
  if (!name || !email || !password) {
    console.error('Usage: --name=Name --username=adminuser --email=you@example.com --password=pass');
    process.exit(1);
  }

  const username = inputUsername || email.split('@')[0];

  // Prevent duplicates
  if (await User.findOne({ email })) {
    console.error(`Error: User with email ${email} already exists.`);
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  const admin = new User({
    name,
    username,
    email,
    password: hash,
    role: 'admin',
    isPaidUser: true,
    currentPlan: 'Admin',
    subscriptionEndDate: null
  });

  await admin.save();
  console.log(`✅ Admin created: ${email} (username: ${username})`);
  process.exit(0);
}

main().catch(err => {
  console.error('Error creating admin:', err.message);
  process.exit(1);
});
