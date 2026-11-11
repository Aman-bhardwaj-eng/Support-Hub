require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const connectDB = require("./db");

// Import routes
const complaintRoutes = require("./routes/complaintRoutes");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const engineerRoutes = require("./routes/engineerRoutes");
const { handleWebhook } = require("./services/botService");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({
  limit: "1mb",
  verify: (req, res, buffer) => { req.rawBody = Buffer.from(buffer); }
}));
app.use(express.urlencoded({ extended: true }));

// Serve frontend files from public folder
app.use(express.static(path.join(__dirname, "public")));

// Home route
app.get("/", (req, res) => {
  res.send("Support Hub Backend is running!");
});

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Support Hub backend is healthy",
    timestamp: new Date().toISOString(),
  });
});

// Test route
app.get("/test-route", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Test route works!",
  });
});

// WhatsApp webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    process.env.VERIFY_TOKEN &&
    token === process.env.VERIFY_TOKEN
  ) {
    console.log("WhatsApp webhook verified successfully");
    return res.status(200).send(challenge);
  }

  console.log("WhatsApp webhook verification failed");
  return res.sendStatus(403);
});

// Receive WhatsApp webhook events. Acknowledge Meta quickly, then process messages.
// Do not log full payloads because they may contain customer personal information.
app.post("/webhook", (req, res) => {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (appSecret) {
    const signature = req.get("x-hub-signature-256") || "";
    const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(req.rawBody || Buffer.from("" )).digest("hex");
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
      return res.sendStatus(401);
    }
  }
  const body = req.body;
  res.sendStatus(200);
  Promise.resolve()
    .then(() => handleWebhook(body))
    .catch((error) => console.error("WhatsApp webhook processing failed:", error.message));
});

// API routes
app.use("/api/complaints", complaintRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/engineer", engineerRoutes);

// Handle malformed JSON
app.use((err, req, res, next) => {
  if (
    err instanceof SyntaxError &&
    err.status === 400 &&
    "body" in err
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON request body",
    });
  }

  console.error("Server error:", err.message);

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

// 404 handler - must be last
app.use((req, res) => {
  if (req.originalUrl.startsWith("/api/")) {
    return res.status(404).json({
      success: false,
      message: "API route not found",
      path: req.originalUrl,
    });
  }

  return res.status(404).send("404 - Page not found");
});

// Start server after connecting to MongoDB
async function startServer() {
  try {
    await connectDB();
    if (!process.env.WHATSAPP_APP_SECRET) {
      console.warn("[WhatsApp] WHATSAPP_APP_SECRET is not configured; webhook signature verification is disabled.");
    }

    app.listen(PORT, () => {
      console.log("Support Hub started successfully!");
      console.log(`Backend: http://localhost:${PORT}`);
      console.log(`Health: http://localhost:${PORT}/health`);
      console.log(`Admin Login: http://localhost:${PORT}/admin.html`);
      console.log(
        `Admin Dashboard: http://localhost:${PORT}/admin-dashboard.html`
      );
      console.log(
        `Engineer Login: http://localhost:${PORT}/engineer-login.html`
      );
      console.log(
        `Engineer Dashboard: http://localhost:${PORT}/engineer-dashboard.html`
      );
    });
  } catch (error) {
    console.error("Failed to start Support Hub:", error.message);
    process.exit(1);
  }
}

startServer();