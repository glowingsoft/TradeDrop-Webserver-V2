const express = require("express");
const {
  createHelpCenter,
  getHelpCenters,
  updateHelpCenter,
  deleteHelpCenter,
  getHelpCenterDetails
} = require("./helpCenterController"); // Assuming you have a separate controller for promo codes
const createRateLimiter = require("../../../helperUtils/rateLimiter");
const auth = require("../../../middlewares/authMiddleware");
const roleMiddleware = require("../../../middlewares/roleMiddleware");

const router = express.Router();

router.use(auth);


const HelpCenterRateLimiter = createRateLimiter("HelpCenters");


router.post("/", roleMiddleware(["admin"]), HelpCenterRateLimiter, createHelpCenter);


router.get("/", roleMiddleware(["admin", "user","coach"]), HelpCenterRateLimiter, getHelpCenters);


// Update an existing Promo Code
router.put("/:id", roleMiddleware(["admin"]), updateHelpCenter);
router.get("/:id", roleMiddleware(["admin", "user","coach"]), getHelpCenterDetails);

// Delete a Promo Code
router.delete("/:id", roleMiddleware(["admin"]), deleteHelpCenter);

module.exports = router;
