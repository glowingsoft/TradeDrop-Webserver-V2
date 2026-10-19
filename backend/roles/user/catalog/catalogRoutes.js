const express = require("express");
const { getCategories, getTimingChips, getAppSettings } = require("./catalogController");

const router = express.Router();

// Public — no JWT
router.get("/categories", getCategories);
router.get("/timing-chips", getTimingChips);
router.get("/app-settings", getAppSettings);

module.exports = router;
