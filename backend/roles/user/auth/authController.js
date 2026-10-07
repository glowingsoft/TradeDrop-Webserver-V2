const { sendResponse, validateParams } = require("../../../helperUtils/responseUtil");
const authService = require("./authService");

function handleError(res, error) {
  const statusCode = error.statusCode || 500;
  const translationKey = error.translationKey || "internal_server_error";
  return sendResponse({
    res,
    statusCode,
    translationKey,
    error,
  });
}

const register = async (req, res) => {
  const validationOptions = {
    rawData: ["email", "password"],
    minLengthFields: { password: 8 },
  };
  if (!validateParams(req, res, validationOptions)) return;

  try {
    const result = await authService.register(req.body);
    const data = result.user;
    if (result.debugOtp) data.debugOtp = result.debugOtp;
    return sendResponse({
      res,
      statusCode: 201,
      translationKey: "signup_successful",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const login = async (req, res) => {
  const validationOptions = {
    rawData: ["email", "password"],
  };
  if (!validateParams(req, res, validationOptions)) return;

  try {
    const data = await authService.login(req.body);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "login_success",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const verifyOtp = async (req, res) => {
  const validationOptions = {
    rawData: ["email", "code", "purpose"],
    enumFields: { purpose: ["signup", "password_reset"] },
  };
  if (!validateParams(req, res, validationOptions)) return;

  try {
    const data = await authService.verifyOtp(req.body);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "otp_verified",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const resendOtp = async (req, res) => {
  const validationOptions = {
    rawData: ["email", "purpose"],
    enumFields: { purpose: ["signup", "password_reset"] },
  };
  if (!validateParams(req, res, validationOptions)) return;

  try {
    const data = await authService.resendOtp(req.body);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "otp_resent",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const forgotPassword = async (req, res) => {
  const validationOptions = { rawData: ["email"] };
  if (!validateParams(req, res, validationOptions)) return;

  try {
    const data = await authService.forgotPassword(req.body);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "password_reset_otp_sent",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const resetPassword = async (req, res) => {
  const validationOptions = {
    rawData: ["email", "password"],
    minLengthFields: { password: 8 },
  };
  if (!validateParams(req, res, validationOptions)) return;

  try {
    const data = await authService.resetPassword(req.body);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "password_reset_success",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const refresh = async (req, res) => {
  try {
    const data = await authService.refresh(req.user._id);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "token_refreshed",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const logout = async (req, res) => {
  try {
    authService.logout();
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "logout_success",
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const getMe = async (req, res) => {
  try {
    const data = await authService.getMe(req.user._id);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "profile_fetched",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

/** Slice-1 owned gate: verified + onboarded */
const gatedProbe = async (req, res) => {
  try {
    const data = await authService.gatedProbe(req.user._id);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "gate_passed",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = {
  register,
  login,
  verifyOtp,
  resendOtp,
  forgotPassword,
  resetPassword,
  refresh,
  logout,
  getMe,
  gatedProbe,
};
