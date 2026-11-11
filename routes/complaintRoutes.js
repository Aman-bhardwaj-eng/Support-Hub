
const express = require("express");
const crypto = require("crypto");
const Complaint = require("../models.js/Complaint");
const { getSerialDetails } = require("../services/erpService");

const router = express.Router();

// Convert ERP errors into safe API responses.
function handleErpError(error, res) {
  if (error.status === 404) {
    return res.status(404).json({
      success: false,
      code: "SERIAL_NOT_FOUND",
      message:
        "Serial number was not found in ERP. Please provide the warranty card or purchase bill for further verification."
    });
  }

  if (error.status === 400) {
    return res.status(400).json({
      success: false,
      message: "Please provide a valid serial number."
    });
  }

  console.error("ERP verification failed:", error.message);

  return res.status(503).json({
    success: false,
    code: "ERP_UNAVAILABLE",
    message:
      "Serial verification is temporarily unavailable. Please try again later."
  });
}

// Verify a serial number using Battery ERP.
// IMPORTANT: Keep this route before /:complaintId.
router.get("/verify-serial/:serialNumber", async (req, res) => {
  try {
    const serialNumber = String(
      req.params.serialNumber || ""
    ).trim();

    if (!serialNumber || serialNumber.length > 100) {
      return res.status(400).json({
        success: false,
        message: "A valid serial number is required."
      });
    }

    const data = await getSerialDetails(serialNumber);

    return res.status(200).json({
      success: true,
      message: "Serial number verified successfully.",
      data
    });
  } catch (error) {
    return handleErpError(error, res);
  }
});

// Register a new complaint.
router.post("/", async (req, res) => {
  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({
      success: false,
      message: "Request body is missing. Send JSON in the request body."
    });
  }

  try {
    const {
      name,
      mobile,
      state,
      city,
      area,
      pinCode,
      product,
      model,
      serialNumber,
      description
    } = req.body;

    if (
      !name ||
      !mobile ||
      !state ||
      !city ||
      !area ||
      !pinCode ||
      !product ||
      !description
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Please provide all required customer and complaint details."
      });
    }

    let verifiedProduct = product;
    let verifiedModel = model || "";
    let verifiedSerial = String(serialNumber || "").trim();
    let erpData = null;

    // If a serial number is supplied, verify it before registration.
    if (verifiedSerial) {
      try {
        erpData = await getSerialDetails(verifiedSerial);

        // Keep the complaint category (enum) as chosen by customer; store
        // ERP product + model text in the model field.
        verifiedModel = [erpData.product_name, erpData.model_name]
          .filter(Boolean)
          .join(" - ");
        verifiedSerial = erpData.serial_number;
      } catch (error) {
        return handleErpError(error, res);
      }
    }

    const complaintId =
      "SH-" +
      Date.now().toString().slice(-8) +
      "-" +
      crypto.randomBytes(2).toString("hex").toUpperCase();

    const complaint = await Complaint.create({
      complaintId,
      customer: {
        name,
        mobile,
        state,
        city,
        area,
        pinCode
      },
      product: verifiedProduct,
      model: verifiedModel,
      serialNumber: verifiedSerial,
      description,
      source: "WEB",
      erpVerified: Boolean(erpData)
    });

    return res.status(201).json({
      success: true,
      message: "Complaint registered successfully.",
      complaintId: complaint.complaintId,
      status: complaint.status,
      erpVerified: Boolean(erpData),
      productDetails: erpData
        ? {
            serialNumber: erpData.serial_number,
            product: erpData.product_name,
            model: erpData.model_name,
            category: erpData.category_name,
            dealer: erpData.dealer_name,
            dealerCode: erpData.dealer_code,
            dispatchDate: erpData.dispatch_date,
            warrantyMonths: erpData.warranty_months,
            warranty: erpData.warranty
          }
        : null
    });
  } catch (error) {
    console.error("Complaint registration error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to register complaint."
    });
  }
});

// Track complaint using its ID.
router.get("/:complaintId", async (req, res) => {
  try {
    const complaint = await Complaint.findOne({
      complaintId: req.params.complaintId
    })
      .select(
        "complaintId product status description createdAt updatedAt resolution.remarks"
      )
      .lean();

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: "Complaint not found."
      });
    }

    return res.status(200).json({
      success: true,
      complaint
    });
  } catch (error) {
    console.error("Complaint tracking error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to track complaint."
    });
  }
});

module.exports = router;
