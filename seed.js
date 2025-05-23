const mongoose = require("mongoose");
const SubscriptionPlan = require("./models/SubscriptionPlan");
const connectDB = require("./db");

connectDB();

const plans = [
  {
    name: "Free",
    duration: 0,
    prices: [
      { currency: "USD", amount: 0 },
      { currency: "INR", amount: 0 },
    ],
    features: ["Basic access"],
    limits: { campaignsPerMonth: 5 },
  },
  {
    name: "1 Day",
    duration: 1,
    prices: [
      { currency: "USD", amount: 4.99 },
      { currency: "INR", amount: 99 },
    ],
    features: ["Full access for 1 day"],
    limits: { campaignsPerMonth: 0 },
  },
  {
    name: "1 Week",
    duration: 7,
    prices: [
      { currency: "USD", amount: 24.99 },
      { currency: "INR", amount: 599 },
    ],
    features: ["Full access for 1 week"],
    limits: { campaignsPerMonth: 0 },
  },
  {
    name: "1 Month",
    duration: 30,
    prices: [
      { currency: "USD", amount: 99 },
      { currency: "INR", amount: 1999 },
    ],
    features: ["Full access for 1 month"],
    limits: { campaignsPerMonth: 0 },
  },
];

const seedPlans = async () => {
  try {
    await SubscriptionPlan.deleteMany({});
    await SubscriptionPlan.insertMany(plans);
    console.log("Subscription plans seeded successfully");
    process.exit();
  } catch (error) {
    console.error("Error seeding plans:", error);
    process.exit(1);
  }
};

seedPlans();
