const express = require("express");
const {
  createOrUpdateCategory,
  listAllCategories,
  getCategories,
  updateCategory,
  updateCategoryStatus,
  addOrUpdateCmsPage,
  listCmsPages,
  listTimingChips,
  createTimingChip,
  updateTimingChip,
  removeTimingChip,
  updateAppSettings,
  getAppSettings,
} = require("./adminCatalogController");

const router = express.Router();

// Category admin routes
router.post("/categories", createOrUpdateCategory);
router.get("/categories", listAllCategories);
router.get("/categories/all", getCategories);
router.patch("/categories/:id/status", updateCategoryStatus);
router.put("/categories/:id", updateCategory);

// CMS Page admin routes
router.post("/cms-pages", addOrUpdateCmsPage);
router.get("/cms-pages", listCmsPages);

router.get("/timing-chips", listTimingChips);
router.post("/timing-chips", createTimingChip);
router.patch("/timing-chips/:id", updateTimingChip);
router.delete("/timing-chips/:id", removeTimingChip);

router.patch("/app-settings", updateAppSettings);
router.get("/app-settings", getAppSettings);

module.exports = router;
