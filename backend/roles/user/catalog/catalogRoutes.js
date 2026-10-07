const express = require("express");
const { getCategories, getTimingChips, getCmsBySlug, getAppSettings } = require("./catalogController");

const router = express.Router();

// Public — no JWT
router.get("/categories", getCategories);
router.get("/timing-chips", getTimingChips);
router.get("/cms/:slug", getCmsBySlug);
router.get("/app-settings", getAppSettings);

module.exports = router;
