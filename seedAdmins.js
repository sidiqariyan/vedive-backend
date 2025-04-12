require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// Import your database connection and User model
const connectDB = require("./db");
const User = require("./models/User");

async function seedAdmins() {
  try {
    await connectDB();

    // Define the static admin users
    const admins = [
      {
        username: "ferdaws@vedive.com",
        email: "ferdaws@vedive.com",
        password: "8460269Ferdaws!",
        role: "admin",
        name: "Ferdaws Admin",
      },
      {
        username: "samim@vedive.com",
        email: "samim@vedive.com",
        password: "8460269samim!",
        role: "admin",
        name: "Samim Admin",
      },
    ];

    for (const adminData of admins) {
      // Check if an admin with the provided email already exists
      const existingAdmin = await User.findOne({ email: adminData.email });
      if (existingAdmin) {
        console.log(`Admin already exists: ${adminData.email}`);
        continue;
      }
      // Hash the admin password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(adminData.password, salt);
      adminData.password = hashedPassword;

      // Create and save the new admin user
      const newAdmin = new User(adminData);
      await newAdmin.save();
      console.log(`Created admin: ${adminData.email}`);
    }
    
    console.log("Admin seeding completed.");
    process.exit();
  } catch (error) {
    console.error("Error seeding admins:", error);
    process.exit(1);
  }
}

seedAdmins();
