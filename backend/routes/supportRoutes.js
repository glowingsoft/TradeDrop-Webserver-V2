// routes/supportRoutes.js
const express = require("express");
const {
  createSupportRequest,
  getSupportRequests,
  updateSupportRequestStatus,
  deleteSupportRequest
} = require("../controllers/supportController");
const createRateLimiter = require("../helperUtils/rateLimiter");
const auth = require("@middlewares/authMiddleware");
const router = express.Router();
const supportRateLimiter = createRateLimiter("support", 10, 5);
router.use(auth);
router.post("/", supportRateLimiter, createSupportRequest);



module.exports = router;
