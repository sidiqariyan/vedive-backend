const mongoose = require("mongoose");

const connectDB = async () => {
  console.log("Attempting to connect to MongoDB...");

  // Validate MONGO_URI environment variable
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is not defined in the environment variables.");
    process.exit(1); // Exit process if MONGO_URI is missing
  }

  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log(`MongoDB connected: ${conn.connection.host}`);

    // Optional: Listen to Mongoose connection events
    mongoose.connection.on("disconnected", () => {
      console.warn("MongoDB disconnected!");
    });

    mongoose.connection.on("error", (err) => {
      console.error(`MongoDB connection error: ${err.message}`);
    });
  } catch (error) {
    console.error("MongoDB connection error:", error.message);

    // Graceful shutdown (optional)
    setTimeout(() => {
      process.exit(1);
    }, 5000); // Wait 5 seconds before exiting to allow logs to flush
  }
};

module.exports = connectDB;