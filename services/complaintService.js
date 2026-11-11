const crypto = require("crypto");
const Complaint = require("../models.js/Complaint");

function newComplaintId() {
  return (
    "SH-" +
    Date.now().toString().slice(-8) +
    "-" +
    crypto.randomBytes(2).toString("hex").toUpperCase()
  );
}

async function createComplaint(fields) {
  return Complaint.create({ complaintId: newComplaintId(), ...fields });
}

module.exports = { newComplaintId, createComplaint };
