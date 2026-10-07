const express = require("express");
const auth = require("../../../middlewares/authMiddleware");
const roleMiddleware = require("../../../middlewares/roleMiddleware");
const { createBadge, getBadges, getBadgeById, updateBadge, deleteBadge } = require("./badgesController");

const router = express.Router();

router.use(auth);
router.use(roleMiddleware(["admin"]));

router.post("/", createBadge);
router.get("/", getBadges);
router.get("/:id", getBadgeById);
router.patch("/:id", updateBadge);
router.delete("/:id", deleteBadge);

module.exports = router;
