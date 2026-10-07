const speakeasy = require("speakeasy");
const qrcode = require("qrcode");

/**
 * Generate a new 2FA secret
 * @param {string} appName - Issuer (e.g., your app name)
 * @param {string} userIdentifier - Usually email
 * @returns {{ secret: string, otpauthUrl: string }}
 */
const generate2FASecret = (appName, userIdentifier) => {
  const secret = speakeasy.generateSecret({
    length: 32,
    name: `${appName} (${userIdentifier})`,
    issuer: appName,
  });

  return {
    secret: secret.base32,
    otpauthUrl: secret.otpauth_url,
  };
};

/**
 * Generate QR Code from otpauth URL
 * @param {string} otpauthUrl
 * @returns {Promise<string>} QR Code as Base64 Data URL
 */
const generateQRCode = async (otpauthUrl) => {
  return qrcode.toDataURL(otpauthUrl);
};

/**
 * Verify 2FA token
 * @param {string} token - 6-digit token from authenticator
 * @param {string} secret - Base32 secret stored in DB
 * @returns {boolean}
 */
const verify2FAToken = (token, secret) => {
  return speakeasy.totp.verify({
    secret,
    encoding: "base32",
    token,
    window: 1,
  });
};

module.exports = {
  generate2FASecret,
  generateQRCode,
  verify2FAToken,
};
