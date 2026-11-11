
console.log("TEST FILE STARTED");

require("dotenv").config();
const connectDB = require("./db");
const mongoose = require("mongoose");

async function testDatabase() {
  console.log("Checking MongoDB connection...");

  try {
    await connectDB();
    console.log("Database test completed.");
  } catch (error) {
    console.error("Test failed:", error.message);
  } finally {
    await mongoose.disconnect();
    console.log("Test finished.");
  }
}

testDatabase();
