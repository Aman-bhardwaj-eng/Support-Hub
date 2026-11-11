const axios = require("axios");

// Talks to Battery ERP: GET {ERP_BASE_URL}/api/integration/serial/:serial
// Auth: x-integration-key header (must equal ERP_SUPPORT_API_KEY in the ERP .env)
function makeError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function getSerialDetails(serialNumber) {
  const serial = String(serialNumber || "").trim();
  if (!serial || serial.length > 100) throw makeError(400, "Invalid serial number");

  // ERP_API_URL may point either to the integration base (/api/integration)
  // or to the ERP server root. Keep compatibility with the older ERP_BASE_URL.
  const configuredUrl = (process.env.ERP_API_URL || process.env.ERP_BASE_URL || "http://localhost:5000").trim().replace(/\/+$/, "");
  const integrationBase = configuredUrl.endsWith("/api/integration")
    ? configuredUrl
    : `${configuredUrl}/api/integration`;
  const apiKey = process.env.ERP_SUPPORT_API_KEY || process.env.ERP_API_KEY;
  if (!apiKey) throw makeError(503, "ERP integration key is not configured in Support Hub .env");

  try {
    const res = await axios.get(
      `${integrationBase}/serial/${encodeURIComponent(serial)}`,
      { headers: { "x-integration-key": apiKey }, timeout: 8000 }
    );
    if (!res.data || !res.data.success || !res.data.data) {
      throw makeError(502, "Unexpected ERP response");
    }
    return res.data.data;
  } catch (error) {
    if (error.status) throw error;
    const status = error.response && error.response.status;
    if (status === 404) throw makeError(404, "Serial not found in ERP");
    if (status === 400) throw makeError(400, "Invalid serial number");
    throw makeError(503, `ERP unreachable: ${error.message}`);
  }
}

// Human readable warranty state, calculated from ERP dates.
function describeWarranty(data) {
  const w = data && data.warranty;
  if (!data.dispatched) {
    return { state: "NOT_DISPATCHED", text: "Not yet dispatched to a dealer" };
  }
  if (!w) {
    return { state: "NOT_ACTIVATED", text: "Warranty not activated yet" };
  }
  const expiry = w.expiry_date ? new Date(w.expiry_date) : null;
  const status = String(w.status || "").toLowerCase();
  const fmt = (d) => (d ? new Date(d).toLocaleDateString("en-IN") : "-");
  if (status === "expired" || (expiry && expiry < new Date())) {
    return { state: "EXPIRED", text: `Warranty expired on ${fmt(w.expiry_date)}` };
  }
  if (status === "claimed") {
    return { state: "CLAIMED", text: `Warranty already claimed (valid till ${fmt(w.expiry_date)})` };
  }
  if (status === "pending") {
    return { state: "NOT_ACTIVATED", text: "Warranty activation is pending" };
  }
  return { state: "ACTIVE", text: `In warranty - valid till ${fmt(w.expiry_date)}` };
}

module.exports = { getSerialDetails, describeWarranty };
