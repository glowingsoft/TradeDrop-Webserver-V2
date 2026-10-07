// routes/bulkInsertRoutes.js
const express = require("express");
const { bulkInsertHandler, deleteCollectionHandler } = require("../controllers/dbController");
const auth = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const router = express.Router();

// Route for bulk insertion
router.post("/bulkInsert", auth, roleMiddleware(["admin"]), bulkInsertHandler);
router.post("/deleteCollection", auth, roleMiddleware(["admin"]), deleteCollectionHandler);


module.exports = router;
