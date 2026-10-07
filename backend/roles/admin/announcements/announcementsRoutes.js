const express = require("express");
const auth = require("../../../middlewares/authMiddleware");
const roleMiddleware = require("../../../middlewares/roleMiddleware");
const {
  createAnnouncement,
  getAnnouncements,
  readAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} = require("./announcementsController");

const router = express.Router();

router.use(auth);
router.use(roleMiddleware(["admin"]));
router.post("/", createAnnouncement);
router.get("/", getAnnouncements);
router.put("/:id", updateAnnouncement);
router.delete("/:id", deleteAnnouncement);

module.exports = router;
