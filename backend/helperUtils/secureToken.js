const crypto = require("crypto");

function generateSecureToken() {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

  return { rawToken, hashedToken };
}

module.exports = { generateSecureToken };
