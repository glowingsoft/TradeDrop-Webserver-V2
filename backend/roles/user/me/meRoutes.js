const express = require("express");
const { authenticate } = require("../auth/tfAuthMiddleware");
const { requireVerifiedOnboarded } = require("../auth/tfAuthMiddleware");
const { sendResponse } = require("../../../helperUtils/responseUtil");
const {
  getMe,
  patchMe,
  postCraft,
  postPortfolio,
  deletePortfolio,
  patchPrivacy,
  deleteMe,
} = require("./profileController");
const {
  getUserAnnouncements,
  readAnnouncement,
} = require("@backend/roles/admin/announcements/announcementsController");

const router = express.Router();

router.use(authenticate);

router.get("/", getMe);
router.get("/announcements", getUserAnnouncements);
router.patch("/announcements/:id/read", readAnnouncement);
router.patch("/", patchMe);
router.post("/crafts", postCraft);
router.post("/portfolio", postPortfolio);
router.delete("/portfolio/:id", deletePortfolio);
router.patch("/privacy", patchPrivacy);
router.delete("/", deleteMe);

/** Gate: verified email + onboardingComplete (checked in service for this probe) */
router.post("/gated-action", requireVerifiedOnboarded, (req, res) => {
  return sendResponse({
    res,
    statusCode: 200,
    translationKey: "gate_passed",
    data: req.tfUser,
  });
});

module.exports = router;
