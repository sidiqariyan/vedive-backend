#!/usr/bin/env node
/**
 * Script to create an initial admin user in the database.
 * Usage from project root: node scripts/createAdmin.js --name=AdminName --email=admin@example.com --password=YourPass123
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const argv = require('minimist')(process.argv.slice(2));

// Adjust path: script lives in scripts/, so go up one level to import models
const User = require('../models/User');

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('Error: MONGO_URI not set in .env');
  process.exit(1);
}

async function main() {
  await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

  const { name, email, password } = argv;
  if (!name || !email || !password) {
    console.error('Usage: node scripts/createAdmin.js --name=Name --email=you@example.com --password=pass');
    process.exit(1);
  }

  // Check if user already exists
  const exists = await User.findOne({ email });
  if (exists) {
    console.error(`User with email ${email} already exists.`);
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  const admin = new User({
    name,
    email,
    password: hash,
    role: 'admin',
    isPaidUser: true,
    currentPlan: 'Admin',
    subscriptionEndDate: null
  });

  await admin.save();
  console.log(`✅ Admin user created: ${email}`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
