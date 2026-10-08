const authMiddleware = require("@backend/middlewares/authMiddleware");
const roleMiddleware = require("@backend/middlewares/roleMiddleware");
const { requireVerifiedOnboarded } = require("./controllerKit");

const authenticate = authMiddleware;
const optionalAuth = (req, res, next) => (req.header("Authorization") ? authMiddleware(req, res, next) : next());
const gated = [authenticate, requireVerifiedOnboarded];
const adminOnly = [authenticate, roleMiddleware(["admin"])];

module.exports = { authenticate, optionalAuth, gated, adminOnly };
