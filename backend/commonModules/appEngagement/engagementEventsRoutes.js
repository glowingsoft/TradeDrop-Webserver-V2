const express = require("express");
const auth = require("../../middlewares/authMiddleware");
const {
  logEngagement,
  getTrending,
  getLeads,
} = require("./engagementEventsController");

const router = express.Router();

router.use(auth);

/* 
example log engagement request body:
{
  "entityType": "coachservices",
  "entityId": "691580a7750069869d13db94",
  "eventType": "service_view"
}

*/
router.post("/log", logEngagement);
router.get("/trending", getTrending);
router.get("/leads", getLeads);

module.exports = router;
