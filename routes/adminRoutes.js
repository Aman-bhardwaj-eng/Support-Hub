
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");

const Complaint = require("../models.js/Complaint");
const Engineer = require("../models.js/Engineer");
const { notifyCustomer } = require("../services/botService");

const router = express.Router();

// Admin authentication middleware
function requireAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({
        success: false,
        message: "Admin login required.",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin access required.",
      });
    }

    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token.",
    });
  }
}

router.use(requireAdmin);


// Serve complaint proof documents only to authenticated admins. Files are stored outside the public folder.
router.get("/proof/:filename", async (req, res) => {
  const filename = String(req.params.filename || "");
  if (!/^[a-f0-9-]+\.(?:jpg|png|pdf)$/i.test(filename)) {
    return res.status(400).json({ success: false, message: "Invalid proof document name." });
  }
  const filePath = path.join(__dirname, "..", "private_uploads", "complaint-proofs", filename);
  return res.sendFile(filePath, (error) => {
    if (error && !res.headersSent) res.status(error.statusCode === 404 ? 404 : 500).json({ success: false, message: "Proof document could not be opened." });
  });
});

// Get complaints with optional status filter
router.get("/complaints", async (req, res) => {
  try {
    const filter = {};

    if (req.query.status) {
      filter.status = req.query.status;
    }

    const complaints = await Complaint.find(filter)
      .populate("engineer", "name mobile")
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.json({
      success: true,
      count: complaints.length,
      complaints,
    });
  } catch (error) {
    console.error("Admin complaints error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch complaints.",
    });
  }
});

// Create an engineer account
router.post("/engineers", async (req, res) => {
  try {
    const { name, mobile, email, password, state, district, city, pinCode } = req.body;

    if (!name || !mobile || typeof password !== "string" || password.length < 8 ||
        !state || !district || !city || !/^\d{6}$/.test(String(pinCode || "").trim())) {
      return res.status(400).json({
        success: false,
        message: "Name, mobile, password (minimum 8 characters) and valid service state, district, city and 6-digit PIN code are required.",
      });
    }

    const normalizedMobile = String(mobile).replace(/\D/g, "");
    const normalizedEmail = String(email || "").trim().toLowerCase();

    const existing = await Engineer.findOne({
      mobile: normalizedMobile,
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "An engineer with this mobile already exists.",
      });
    }

    const engineer = await Engineer.create({
      name,
      mobile: normalizedMobile,
      email: normalizedEmail,
      password: await bcrypt.hash(password, 12),
      state: String(state).trim(),
      district: String(district).trim(),
      city: String(city).trim(),
      pinCode: String(pinCode).trim(),
    });

    return res.status(201).json({
      success: true,
      message: "Engineer account created.",
      engineer: {
        id: engineer._id,
        name: engineer.name,
        mobile: engineer.mobile,
        email: engineer.email,
        state: engineer.state,
        district: engineer.district,
        city: engineer.city,
        pinCode: engineer.pinCode,
      },
    });
  } catch (error) {
    console.error("Create engineer error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to create engineer.",
    });
  }
});

// Assign an engineer to a complaint
router.patch("/complaints/:complaintId/assign", async (req, res) => {
  try {
    const { engineerId } = req.body;

    if (!engineerId) {
      return res.status(400).json({
        success: false,
        message: "Engineer ID is required.",
      });
    }

    const engineer = await Engineer.findOne({
      _id: engineerId,
      isActive: true,
    });

    if (!engineer) {
      return res.status(404).json({
        success: false,
        message: "Active engineer not found.",
      });
    }

    const existingComplaint = await Complaint.findOne({ complaintId: req.params.complaintId });
    if (!existingComplaint) {
      return res.status(404).json({ success: false, message: "Complaint not found." });
    }

    const norm = (value) => String(value || "").trim().toLowerCase();
    const customer = existingComplaint.customer || {};
    const sameState = norm(engineer.state) === norm(customer.state);
    const sameCity = norm(engineer.city) === norm(customer.city);
    const samePin = norm(engineer.pinCode) === norm(customer.pinCode);
    if (!sameState || (!sameCity && !samePin)) {
      return res.status(400).json({
        success: false,
        message: "This engineer's assigned service area does not match the customer's state/city/PIN code.",
      });
    }

    const complaint = await Complaint.findOneAndUpdate(
      { complaintId: req.params.complaintId },
      { $set: { engineer: engineer._id, status: "ASSIGNED" } },
      { new: true, runValidators: true }
    ).populate("engineer", "name mobile state district city pinCode");

    await notifyCustomer(
      complaint,
      `Our support team has assigned an engineer to complaint *${complaint.complaintId}*. The engineer will contact you for the visit.`
    );

    return res.json({
      success: true,
      message: "Engineer assigned successfully.",
      complaint,
    });
  } catch (error) {
    console.error("Assign engineer error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to assign engineer.",
    });
  }
});

// List active engineers
router.get("/engineers", async (req, res) => {
  try {
    const engineers = await Engineer.find({ isActive: true })
      .select("name mobile email state district city pinCode")
      .sort({ name: 1 })
      .lean();

    return res.json({
      success: true,
      engineers,
    });
  } catch (error) {
    console.error("Fetch engineers error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch engineers.",
    });
  }
});

module.exports = router;

