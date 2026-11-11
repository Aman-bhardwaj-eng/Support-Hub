
const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const Complaint = require("../models.js/Complaint");
const { notifyCustomer } = require("../services/botService");

const OTP_TTL_MINUTES = 15;
const OTP_MAX_ATTEMPTS = 5;

function hashOtp(otp) {
  return crypto
    .createHmac("sha256", process.env.JWT_SECRET || "")
    .update(String(otp))
    .digest("hex");
}

// Generate a 6-digit OTP, store only its hash, WhatsApp it to the customer.
async function issueClosureOtp(complaint) {
  const otp = String(crypto.randomInt(100000, 1000000));
  complaint.closureOTP = {
    hash: hashOtp(otp),
    expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
    attempts: 0,
  };
  complaint.status = "OTP_SENT";
  await complaint.save();
  const delivered = await notifyCustomer(
    complaint,
    `Your complaint *${complaint.complaintId}* has been serviced.\n\n` +
      `Closure OTP: *${otp}*\n(valid for ${OTP_TTL_MINUTES} minutes)\n\n` +
      `Share this OTP with the engineer ONLY if your problem is solved.`
  );
  if (!delivered) {
    complaint.status = "RESOLUTION_SUBMITTED";
    complaint.closureOTP = { hash: null, expiresAt: null, attempts: 0 };
    await complaint.save();
    throw new Error("WhatsApp OTP delivery failed; check WhatsApp Cloud API configuration.");
  }
}

const router = express.Router();

// Engineer authentication middleware
function requireEngineer(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({
        success: false,
        message: "Engineer login required.",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== "engineer") {
      return res.status(403).json({
        success: false,
        message: "Engineer access required.",
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

router.use(requireEngineer);

// Get complaints assigned to the logged-in engineer
router.get(["/my-complaints", "/complaints"], async (req, res) => {
  try {
    const complaints = await Complaint.find({
      engineer: req.user.userId,
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      count: complaints.length,
      complaints,
    });
  } catch (error) {
    console.error("Engineer complaints error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch assigned complaints.",
    });
  }
});

// Accept an assigned complaint
router.patch(["/:complaintId/accept", "/complaints/:complaintId/accept"], async (req, res) => {
  try {
    const complaint = await Complaint.findOneAndUpdate(
      {
        complaintId: req.params.complaintId,
        engineer: req.user.userId,
        status: "ASSIGNED",
      },
      { $set: { status: "ENGINEER_ACCEPTED" } },
      { new: true, runValidators: true }
    );
    if (complaint) {
      notifyCustomer(
        complaint,
        `Our engineer has accepted your complaint *${complaint.complaintId}* and will contact you for the visit.`
      );
    }

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: "Assigned complaint not found or already updated.",
      });
    }

    return res.json({
      success: true,
      message: "Complaint accepted.",
      complaint,
    });
  } catch (error) {
    console.error("Accept complaint error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to accept complaint.",
    });
  }
});

// Start the customer visit
router.patch(["/:complaintId/start", "/complaints/:complaintId/start"], async (req, res) => {
  try {
    const complaint = await Complaint.findOneAndUpdate(
      {
        complaintId: req.params.complaintId,
        engineer: req.user.userId,
        status: "ENGINEER_ACCEPTED",
      },
      { $set: { status: "VISIT_STARTED" } },
      { new: true, runValidators: true }
    );
    if (complaint) {
      notifyCustomer(
        complaint,
        `Our engineer has started work on your complaint *${complaint.complaintId}*.`
      );
    }

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: "Complaint not found or must be accepted first.",
      });
    }

    return res.json({
      success: true,
      message: "Visit started.",
      complaint,
    });
  } catch (error) {
    console.error("Start visit error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to start visit.",
    });
  }
});

// Submit resolution after visiting the customer
router.patch(["/:complaintId/resolve", "/complaints/:complaintId/resolve", "/complaints/:complaintId/resolution"], async (req, res) => {
  try {
    const { remarks } = req.body;
    let { partsUsed } = req.body;
    if (typeof partsUsed === "string") {
      partsUsed = partsUsed.split(",").map((p) => p.trim()).filter(Boolean);
    }

    if (typeof remarks !== "string" || !remarks.trim()) {
      return res.status(400).json({
        success: false,
        message: "Resolution remarks are required.",
      });
    }

    if (
      partsUsed !== undefined &&
      (!Array.isArray(partsUsed) ||
        !partsUsed.every((part) => typeof part === "string"))
    ) {
      return res.status(400).json({
        success: false,
        message: "Parts used must be a list of text values.",
      });
    }

    const complaint = await Complaint.findOneAndUpdate(
      {
        complaintId: req.params.complaintId,
        engineer: req.user.userId,
        status: "VISIT_STARTED",
      },
      {
        $set: {
          "resolution.remarks": remarks.trim(),
          "resolution.partsUsed": partsUsed || [],
          "resolution.submittedAt": new Date(),
          status: "RESOLUTION_SUBMITTED",
        },
      },
      { new: true, runValidators: true }
    );

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: "Complaint not found or visit must be started first.",
      });
    }

    await issueClosureOtp(complaint);

    return res.json({
      success: true,
      message:
        "Resolution submitted. A closure OTP has been sent to the customer on WhatsApp.",
      complaint: { complaintId: complaint.complaintId, status: complaint.status },
    });
  } catch (error) {
    console.error("Submit resolution error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to submit resolution.",
    });
  }
});

// Resend closure OTP (e.g. expired or customer did not receive it)
router.patch(
  ["/:complaintId/resend-otp", "/complaints/:complaintId/resend-otp"],
  async (req, res) => {
    try {
      const complaint = await Complaint.findOne({
        complaintId: req.params.complaintId,
        engineer: req.user.userId,
        status: "OTP_SENT",
      });
      if (!complaint) {
        return res.status(404).json({ success: false, message: "No complaint awaiting OTP." });
      }
      await issueClosureOtp(complaint);
      return res.json({ success: true, message: "New OTP sent to the customer." });
    } catch (error) {
      console.error("Resend OTP error:", error.message);
      return res.status(500).json({ success: false, message: "Unable to resend OTP." });
    }
  }
);

// Close complaint with the OTP given by the customer
router.patch(
  ["/:complaintId/verify-otp", "/complaints/:complaintId/verify-otp"],
  async (req, res) => {
    try {
      const otp = String((req.body && req.body.otp) || "").trim();
      if (!/^\d{6}$/.test(otp)) {
        return res.status(400).json({ success: false, message: "Enter the 6-digit OTP." });
      }

      const complaint = await Complaint.findOne({
        complaintId: req.params.complaintId,
        engineer: req.user.userId,
        status: "OTP_SENT",
      }).select("+closureOTP.hash");

      if (!complaint || !complaint.closureOTP.hash) {
        return res.status(404).json({ success: false, message: "No complaint awaiting OTP." });
      }
      if (complaint.closureOTP.attempts >= OTP_MAX_ATTEMPTS) {
        return res.status(429).json({
          success: false,
          message: "Too many wrong attempts. Resend a new OTP.",
        });
      }
      if (!complaint.closureOTP.expiresAt || complaint.closureOTP.expiresAt < new Date()) {
        return res.status(410).json({ success: false, message: "OTP expired. Resend a new OTP." });
      }

      const a = Buffer.from(hashOtp(otp));
      const b = Buffer.from(complaint.closureOTP.hash);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        complaint.closureOTP.attempts += 1;
        await complaint.save();
        return res.status(400).json({ success: false, message: "Incorrect OTP." });
      }

      complaint.status = "COMPLETED";
      complaint.completedAt = new Date();
      complaint.closureOTP = { hash: null, expiresAt: null, attempts: 0 };
      await complaint.save();

      notifyCustomer(
        complaint,
        `✅ Your complaint *${complaint.complaintId}* is now closed. Thank you for choosing us. ` +
          `If the problem returns, send *menu* to register a new complaint.`
      );

      return res.json({ success: true, message: "Complaint closed successfully." });
    } catch (error) {
      console.error("Verify OTP error:", error.message);
      return res.status(500).json({ success: false, message: "Unable to verify OTP." });
    }
  }
);

// Engineer could not fix it / customer not satisfied
router.patch(
  ["/:complaintId/revisit", "/complaints/:complaintId/revisit"],
  async (req, res) => {
    try {
      const complaint = await Complaint.findOneAndUpdate(
        {
          complaintId: req.params.complaintId,
          engineer: req.user.userId,
          status: { $in: ["VISIT_STARTED", "OTP_SENT", "RESOLUTION_SUBMITTED"] },
        },
        { $set: { status: "REVISIT_REQUIRED" } },
        { new: true }
      );
      if (!complaint) {
        return res.status(404).json({ success: false, message: "Complaint not found." });
      }
      notifyCustomer(
        complaint,
        `Your complaint *${complaint.complaintId}* needs another visit. Our team will contact you.`
      );
      return res.json({ success: true, message: "Marked as revisit required." });
    } catch (error) {
      console.error("Revisit error:", error.message);
      return res.status(500).json({ success: false, message: "Unable to update complaint." });
    }
  }
);

module.exports = router;

