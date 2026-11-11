require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Admin = require("../models.js/Admin");

async function createAdmin() {
  try {
    const name = process.env.ADMIN_NAME;
    const email = String(process.env.ADMIN_EMAIL || "")
      .trim()
      .toLowerCase();
    const password = process.env.ADMIN_PASSWORD;

    if (!name || !email || !password) {
      throw new Error("Admin name, email and password are required.");
    }

    if (password.length < 10) {
      throw new Error("Password must be at least 10 characters.");
    }

    await mongoose.connect(process.env.MONGODB_URI);

    const existingAdmin = await Admin.findOne({ email });

    if (existingAdmin) {
      console.log("Admin already exists with this email.");
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await Admin.create({
      name,
      email,
      password: hashedPassword,
      role: "admin",
      isActive: true
    });

    console.log("SUCCESS: Admin account created!");
    console.log("Admin Email:", email);

  } catch (error) {
    console.error("Admin creation failed:", error.message);
    process.exitCode = 1;

  } finally {
    await mongoose.disconnect();
  }
}

createAdmin();