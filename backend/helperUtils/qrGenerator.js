// utils/qrGenerator.js
const QRCode = require("qrcode");

/**
 * Accepts a ready payload object.
 * Responsibility: ONLY convert payload → QR image.
 */
const generateQRCode = async (payload) => {
  if (!payload) {
    throw new Error("qr_payload_required");
  }

  const encoded = Buffer
    .from(JSON.stringify(payload))
    .toString("base64");

  return QRCode.toDataURL(encoded);
};

module.exports = { generateQRCode };