// routes/supportRoutes.js
const express = require("express");
const {
  createSupportRequest,
  getSupportRequest,
  deleteSupportRequest,
  updateSupportRequest
} = require("./supportController");
const createRateLimiter = require("../../../helperUtils/rateLimiter");
const roleMiddleware = require("../../../middlewares/roleMiddleware");
const router = express.Router();
const supportRateLimiter = createRateLimiter("support", 10, 5);
const auth = require("../../../middlewares/authMiddleware");


router.get("/", supportRateLimiter,roleMiddleware(["admin"]), auth,getSupportRequest);
router.delete("/:id", supportRateLimiter,roleMiddleware(["admin"]), auth,deleteSupportRequest);
router.put("/:id", supportRateLimiter,roleMiddleware(["admin"]), auth,updateSupportRequest);




module.exports = router;
