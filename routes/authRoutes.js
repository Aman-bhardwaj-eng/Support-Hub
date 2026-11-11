
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Admin = require("../models.js/Admin");
const Engineer = require("../models.js/Engineer");

const router = express.Router();

function createToken(userId, role) {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing from .env");
  }

  return jwt.sign(
    { userId: userId.toString(), role },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );
}

// Admin login
router.post("/admin/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = req.body.password;

    if (!email || typeof password !== "string" || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const admin = await Admin.findOne({ email }).select("+password");

    if (
      !admin ||
      !admin.isActive ||
      !(await bcrypt.compare(password, admin.password))
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    return res.json({
      success: true,
      token: createToken(admin._id, "admin"),
      user: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: "admin",
      },
    });
  } catch (error) {
    console.error("Admin login error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to log in.",
    });
  }
});

// Engineer login
router.post("/engineer/login", async (req, res) => {
  try {
    const mobile = String(req.body.mobile || "").trim();
    const password = req.body.password;

    if (!mobile || typeof password !== "string" || !password) {
      return res.status(400).json({
        success: false,
        message: "Mobile and password are required.",
      });
    }

    const engineer = await Engineer.findOne({ mobile }).select("+password");

    if (
      !engineer ||
      !engineer.isActive ||
      !(await bcrypt.compare(password, engineer.password))
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid mobile or password.",
      });
    }

    return res.json({
      success: true,
      token: createToken(engineer._id, "engineer"),
      user: {
        id: engineer._id,
        name: engineer.name,
        mobile: engineer.mobile,
        role: "engineer",
      },
    });
  } catch (error) {
    console.error("Engineer login error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to log in.",
    });
  }
});

module.exports = router;

