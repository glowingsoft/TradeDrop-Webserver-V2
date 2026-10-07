const express = require("express");
const {
  sendReminder,
} = require("../controllers/sendReminderController");
const auth = require("../middlewares/authMiddleware");

const router = express.Router();
router.use(auth);


router.post("/", sendReminder);

module.exports = router;
