const Complaint = require("../models.js/Complaint");
const BotSession = require("../models.js/BotSession");
const wa = require("./whatsappService");
const { getSerialDetails, describeWarranty } = require("./erpService");
const { createComplaint } = require("./complaintService");

const PRODUCTS = {
  p_battery: "Battery Issue",
  p_inverter: "Inverter Issue",
  p_solar: "Solar Panel Issue",
  p_charging: "Charging Issue",
  p_other: "Other",
};

const STATUS_TEXT = {
  OPEN: "Registered - waiting for engineer assignment",
  ASSIGNED: "Engineer assigned",
  ENGINEER_ACCEPTED: "Engineer accepted - visit will be scheduled",
  VISIT_STARTED: "Engineer is on the visit",
  RESOLUTION_SUBMITTED: "Work done - closure in progress",
  OTP_SENT: "Closure OTP sent to you - share it with the engineer to close",
  COMPLETED: "Resolved and closed",
  REVISIT_REQUIRED: "Revisit required - team will contact you",
};

const GREETING_WORDS = ["hi", "hello", "hey", "menu", "start", "0", "namaste", "hii"];

// ---------- helpers ----------
async function sendMenu(to, intro) {
  await wa.sendButtons(
    to,
    (intro ? intro + "\n\n" : "") +
      "Welcome to *Support Hub* 🔋\nHow can we help you today?",
    [
      { id: "m_register", title: "Register Complaint" },
      { id: "m_track", title: "Track Complaint" },
      { id: "m_mine", title: "My Complaints" },
    ]
  );
}

async function sendProductList(to) {
  await wa.sendList(to, "Please select the product you are facing an issue with:", "Select Product", [
    { id: "p_battery", title: "Battery" },
    { id: "p_inverter", title: "Inverter" },
    { id: "p_solar", title: "Solar Panel" },
    { id: "p_charging", title: "Charging Issue" },
    { id: "p_other", title: "Other Product" },
  ]);
}

function fmtComplaint(c) {
  return (
    `*${c.complaintId}*\n` +
    `Product: ${c.product}${c.model ? " (" + c.model + ")" : ""}\n` +
    `Status: ${STATUS_TEXT[c.status] || c.status}\n` +
    `Registered: ${new Date(c.createdAt).toLocaleDateString("en-IN")}`
  );
}

// Pull a normalised "input" out of any WhatsApp message type.
function readInput(msg) {
  if (msg.type === "text") return { text: (msg.text.body || "").trim(), id: "" };
  if (msg.type === "interactive") {
    const r = msg.interactive.button_reply || msg.interactive.list_reply || {};
    return { text: (r.title || "").trim(), id: r.id || "" };
  }
  if (msg.type === "image" || msg.type === "document") {
    const media = msg[msg.type] || {};
    return { text: "", id: "", media: { id: media.id, mimeType: media.mime_type, filename: media.filename || "proof" } };
  }
  return { text: "", id: "", unsupported: true };
}

async function save(session, step, dataPatch) {
  session.step = step;
  if (dataPatch) session.data = { ...(session.data || {}), ...dataPatch };
  session.markModified("data");
  session.updatedAt = new Date();
  await session.save();
}

async function askName(from, session) {
  await save(session, "NAME");
  await wa.sendText(from, "Please enter your *full name*:");
}

// ---------- main handler ----------
async function handleMessage(msg) {
  const from = msg.from;
  const input = readInput(msg);
  const key = input.id || input.text.toLowerCase();

  let session = await BotSession.findOne({ phone: from });
  if (!session) session = new BotSession({ phone: from });
  if (session.lastMessageId === msg.id) return; // WhatsApp retried delivery
  session.lastMessageId = msg.id;

  if (input.unsupported) {
    await session.save();
    return wa.sendText(from, "Sorry, I can only read text messages. Please type your reply, or send *menu*.");
  }

  // global commands
  if (GREETING_WORDS.includes(key) || key === "cancel") {
    await save(session, "MENU", { __reset: true });
    session.data = {};
    await session.save();
    return sendMenu(from, key === "cancel" ? "Okay, cancelled." : "");
  }

  switch (session.step) {
    case "MENU": {
      if (input.id === "m_register" || key === "1") {
        await save(session, "PRODUCT");
        return sendProductList(from);
      }
      if (input.id === "m_track" || key === "2") {
        await save(session, "TRACK_ID");
        return wa.sendText(from, "Please enter your *Complaint ID* (e.g. SH-12345678-AB12):");
      }
      if (input.id === "m_mine" || key === "3") {
        const list = await Complaint.find({ "customer.mobile": from })
          .sort({ createdAt: -1 }).limit(5).lean();
        await save(session, "MENU");
        if (!list.length) return sendMenu(from, "No complaints found for this WhatsApp number.");
        return wa.sendText(from, "*Your recent complaints*\n\n" + list.map(fmtComplaint).join("\n\n") + "\n\nSend *menu* for options.");
      }
      return sendMenu(from, "");
    }

    case "PRODUCT": {
      const product = PRODUCTS[input.id];
      if (!product) return sendProductList(from);
      await save(session, "SERIAL", { product });
      return wa.sendText(
        from,
        `You selected *${product}*.\n\nPlease type the product *serial number* (printed on the battery / warranty card).\nIf you don't have it, type *SKIP*.`
      );
    }

    case "SERIAL": {
      if (key === "skip") {
        await save(session, "NAME", { serialNumber: "", erpVerified: false, model: "" });
        return askName(from, session);
      }
      if (input.text.length < 3 || input.text.length > 100) {
        return wa.sendText(from, "That doesn't look like a valid serial number. Please type it again, or type *SKIP*.");
      }
      try {
        const erp = await getSerialDetails(input.text);
        const w = describeWarranty(erp);
        await save(session, "NAME", {
          serialNumber: erp.serial_number,
          model: [erp.product_name, erp.model_name].filter(Boolean).join(" - "),
          erpVerified: true,
          warrantyState: w.state,
          warrantyText: w.text,
        });
        await wa.sendText(
          from,
          `✅ *Serial verified*\nProduct: ${erp.product_name}${erp.model_name ? " - " + erp.model_name : ""}\n` +
            `Dealer: ${erp.dealer_name || "-"}\nWarranty: ${w.text}`
        );
        return askName(from, session);
      } catch (err) {
        if (err.status === 404) {
          await save(session, "SERIAL_RETRY", { pendingSerial: input.text });
          return wa.sendButtons(
            from,
            "We could not find this serial number in our records. Please check and retry, or continue - our team will verify using your warranty card / purchase bill.",
            [
              { id: "s_retry", title: "Re-enter Serial" },
              { id: "s_continue", title: "Continue Anyway" },
            ]
          );
        }
        console.error("[bot] ERP error:", err.message);
        await save(session, "SERIAL_RETRY", { pendingSerial: input.text });
        return wa.sendButtons(
          from,
          "Serial verification is temporarily unavailable. You can continue and our team will verify it later.",
          [
            { id: "s_retry", title: "Try Again" },
            { id: "s_continue", title: "Continue Anyway" },
          ]
        );
      }
    }

    case "SERIAL_RETRY": {
      if (input.id === "s_continue") {
        await save(session, "PROOF", {
          serialNumber: session.data.pendingSerial || "",
          erpVerified: false,
          warrantyState: "UNVERIFIED",
          warrantyText: "Not verified - to be checked by team",
          model: "",
          proofDocuments: []
        });
        return wa.sendText(from, "If available, send a photo of your warranty card/bill or a PDF now (JPG, PNG or PDF, max 10 MB). Otherwise type *SKIP*.");
      }
      await save(session, "SERIAL");
      return wa.sendText(from, "Please type the serial number again (or *SKIP*):");
    }

    case "PROOF": {
      if (key === "skip") {
        await save(session, "NAME");
        return askName(from, session);
      }
      if (!input.media || !input.media.id) {
        return wa.sendText(from, "Please send a JPG, PNG or PDF warranty card/bill, or type *SKIP* if you do not have one.");
      }
      try {
        const proof = await wa.downloadMedia(input.media.id, input.media.mimeType, input.media.filename);
        const current = Array.isArray(session.data.proofDocuments) ? session.data.proofDocuments : [];
        await save(session, "NAME", { proofDocuments: [...current, { mediaId: proof.mediaId, mimeType: proof.mimeType, filename: proof.filename, originalName: proof.originalName }] });
        await wa.sendText(from, "✅ Proof document received securely. Now let's register your complaint.");
        return askName(from, session);
      } catch (error) {
        console.error("[bot] proof upload failed:", error.message);
        return wa.sendText(from, "We could not save that file. Please try a JPG, PNG or PDF under 10 MB, or type *SKIP*.");
      }
    }

    case "NAME": {
      if (input.text.length < 2 || input.text.length > 80) return wa.sendText(from, "Please enter a valid name:");
      await save(session, "STATE", { name: input.text });
      return wa.sendText(from, "Enter your *State*:");
    }
    case "STATE": {
      if (input.text.length < 2) return wa.sendText(from, "Please enter a valid state:");
      await save(session, "CITY", { state: input.text });
      return wa.sendText(from, "Enter your *City*:");
    }
    case "CITY": {
      if (input.text.length < 2) return wa.sendText(from, "Please enter a valid city:");
      await save(session, "AREA", { city: input.text });
      return wa.sendText(from, "Enter your *Area / Locality* (and landmark if any):");
    }
    case "AREA": {
      if (input.text.length < 2) return wa.sendText(from, "Please enter your area / locality:");
      await save(session, "PIN", { area: input.text });
      return wa.sendText(from, "Enter your 6-digit *PIN code*:");
    }
    case "PIN": {
      if (!/^\d{6}$/.test(input.text)) return wa.sendText(from, "PIN code must be exactly 6 digits. Please try again:");
      await save(session, "DESC", { pinCode: input.text });
      return wa.sendText(from, "Please describe the *problem* in a few words:");
    }
    case "DESC": {
      if (input.text.length < 5) return wa.sendText(from, "Please describe the problem in a little more detail:");
      const d = { ...session.data, description: input.text.slice(0, 500) };
      await save(session, "CONFIRM", { description: d.description });
      return wa.sendButtons(
        from,
        `*Please confirm your complaint*\n\nName: ${d.name}\nProduct: ${d.product}\n` +
          `Serial: ${d.serialNumber || "Not provided"}${d.warrantyText ? "\nWarranty: " + d.warrantyText : ""}\n` +
          `Address: ${d.area}, ${d.city}, ${d.state} - ${d.pinCode}\nProblem: ${d.description}`,
        [
          { id: "c_yes", title: "Confirm" },
          { id: "c_no", title: "Cancel" },
        ]
      );
    }

    case "CONFIRM": {
      if (input.id !== "c_yes") {
        if (input.id === "c_no") {
          await save(session, "MENU");
          session.data = {};
          await session.save();
          return sendMenu(from, "Complaint cancelled.");
        }
        return wa.sendText(from, "Please tap *Confirm* or *Cancel*.");
      }
      const d = session.data;
      try {
        const complaint = await createComplaint({
          customer: {
            name: d.name, mobile: from, state: d.state,
            city: d.city, area: d.area, pinCode: d.pinCode,
          },
          product: d.product,
          model: d.model || "",
          serialNumber: d.serialNumber || "",
          description: d.description,
          source: "WHATSAPP",
          erpVerified: Boolean(d.erpVerified),
          warrantyState: d.warrantyState || "",
          proofDocuments: Array.isArray(d.proofDocuments) ? d.proofDocuments : [],
        });
        await save(session, "MENU");
        session.data = {};
        await session.save();
        return wa.sendText(
          from,
          `✅ *Complaint registered*\n\nComplaint ID: *${complaint.complaintId}*\n` +
            `Our team will assign an engineer shortly. You can track it anytime by sending *menu* → Track Complaint.`
        );
      } catch (err) {
        console.error("[bot] create complaint failed:", err.message);
        return wa.sendText(from, "Sorry, we could not register your complaint right now. Please type *menu* and try again.");
      }
    }

    case "TRACK_ID": {
      const id = input.text.toUpperCase().replace(/\s/g, "");
      const c = await Complaint.findOne({ complaintId: id })
        .populate("engineer", "name mobile").lean();
      await save(session, "MENU");
      if (!c) return sendMenu(from, "Complaint ID not found. Please check and try again.");
      let text = "*Complaint status*\n\n" + fmtComplaint(c);
      if (c.engineer && ["ASSIGNED", "ENGINEER_ACCEPTED", "VISIT_STARTED"].includes(c.status)) {
        text += `\nEngineer: ${c.engineer.name} (${c.engineer.mobile})`;
      }
      if (c.status === "COMPLETED" && c.resolution && c.resolution.remarks) {
        text += `\nResolution: ${c.resolution.remarks}`;
      }
      return wa.sendText(from, text + "\n\nSend *menu* for options.");
    }

    default:
      await save(session, "MENU");
      return sendMenu(from, "");
  }
}

// Entry point for POST /webhook payload.
async function handleWebhook(body) {
  const entries = (body && body.entry) || [];
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const msg of value.messages || []) {
        try {
          await handleMessage(msg);
        } catch (err) {
          console.error("[bot] handler error:", err);
        }
      }
    }
  }
}

// ---------- outbound notifications (called from admin/engineer routes) ----------
async function notifyCustomer(complaint, text) {
  try {
    if (!complaint || !complaint.customer || !complaint.customer.mobile) return false;
    const result = await wa.sendText(complaint.customer.mobile, text);
    return Boolean(result);
  } catch (err) {
    console.error("[bot] notify failed:", err.message);
    return false;
  }
}

module.exports = { handleWebhook, handleMessage, notifyCustomer, STATUS_TEXT };
