const axios = require("axios");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const API_VERSION = process.env.WHATSAPP_API_VERSION || "v20.0";

function endpoint() {
  return `https://graph.facebook.com/${API_VERSION}/${process.env.PHONE_NUMBER_ID}/messages`;
}

async function post(payload) {
  if (!process.env.WHATSAPP_TOKEN || !process.env.PHONE_NUMBER_ID) {
    console.warn("[WhatsApp] WHATSAPP_TOKEN / PHONE_NUMBER_ID missing - message not sent");
    return null;
  }
  try {
    const res = await axios.post(
      endpoint(),
      { messaging_product: "whatsapp", recipient_type: "individual", ...payload },
      {
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
        timeout: 10000,
      }
    );
    return res.data;
  } catch (error) {
    const detail = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error("[WhatsApp] send failed:", detail);
    return null;
  }
}

// Indian numbers: WhatsApp gives 919876543210. Keep digits only.
function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return "91" + digits;
  return digits;
}

function sendText(to, body) {
  return post({ to: normalizePhone(to), type: "text", text: { body, preview_url: false } });
}

// Up to 3 buttons. buttons = [{id, title}] (title max 20 chars)
function sendButtons(to, body, buttons) {
  return post({
    to: normalizePhone(to),
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.title.slice(0, 20) },
        })),
      },
    },
  });
}

// Up to 10 rows. rows = [{id, title, description?}] (title max 24 chars)
function sendList(to, body, buttonLabel, rows) {
  return post({
    to: normalizePhone(to),
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: body },
      action: {
        button: buttonLabel.slice(0, 20),
        sections: [
          {
            title: "Options",
            rows: rows.slice(0, 10).map((r) => ({
              id: r.id,
              title: r.title.slice(0, 24),
              ...(r.description ? { description: r.description.slice(0, 72) } : {}),
            })),
          },
        ],
      },
    },
  });
}

async function downloadMedia(mediaId, mimeType, originalName = "proof") {
  if (!process.env.WHATSAPP_TOKEN || !process.env.PHONE_NUMBER_ID) {
    throw new Error("WhatsApp media download credentials are not configured");
  }
  const allowed = new Map([
    ["image/jpeg", ".jpg"],
    ["image/png", ".png"],
    ["application/pdf", ".pdf"]
  ]);
  const extension = allowed.get(String(mimeType || "").toLowerCase());
  if (!extension) throw new Error("Only JPG, PNG or PDF proof documents are accepted");

  const version = API_VERSION;
  const headers = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` };
  const meta = await axios.get(`https://graph.facebook.com/${version}/${encodeURIComponent(mediaId)}`, { headers, timeout: 10000 });
  const url = meta.data && meta.data.url;
  const actualMime = String(meta.data && meta.data.mime_type || mimeType || "").toLowerCase();
  if (!url || !allowed.has(actualMime)) throw new Error("WhatsApp returned an unsupported media file");

  const fileResponse = await axios.get(url, { headers, responseType: "arraybuffer", timeout: 20000, maxContentLength: 10 * 1024 * 1024, maxBodyLength: 10 * 1024 * 1024 });
  const bytes = Buffer.from(fileResponse.data);
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("Proof document must be under 10 MB");

  const directory = path.join(__dirname, "..", "private_uploads", "complaint-proofs");
  await fs.promises.mkdir(directory, { recursive: true });
  const filename = `${crypto.randomUUID()}${allowed.get(actualMime)}`;
  await fs.promises.writeFile(path.join(directory, filename), bytes, { flag: "wx" });
  return { mediaId: String(mediaId), mimeType: actualMime, filename, originalName: String(originalName || "proof").slice(0, 120) };
}

function markRead(messageId) {
  return post({ status: "read", message_id: messageId });
}

module.exports = { sendText, sendButtons, sendList, markRead, normalizePhone, downloadMedia };
