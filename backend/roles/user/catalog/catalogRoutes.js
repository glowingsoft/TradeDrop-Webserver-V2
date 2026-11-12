const express = require("express");
const { getCategories, getOtherCategoryInterests, getTimingChips, getAppSettings } = require("./catalogController");
const { authenticate } = require("../_shared/authGates");

const router = express.Router();

// Public — no JWT
router.get("/categories", getCategories);
router.get("/categories/interests", authenticate, getOtherCategoryInterests);
router.get("/timing-chips", getTimingChips);
router.get("/app-settings", getAppSettings);

module.exports = router;
