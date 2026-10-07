const { randomBytes } = require("crypto");

const createVerificationLink = (token) => {
  return `${process.env.EMAIL_VERIFICATION_LINK}${token}`;
};

const createResetPasswordLink = (token) => {
  return `${process.env.PASSWORD_RESET_LINK}${token}`;
};

const generateResetToken = () => {
  return randomBytes(32).toString("hex");
};


module.exports = {
  createVerificationLink,
  createResetPasswordLink,
  generateResetToken,
};
