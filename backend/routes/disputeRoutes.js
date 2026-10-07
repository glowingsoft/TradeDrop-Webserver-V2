const express = require("express");
const auth = require("../middlewares/authMiddleware");
const createRateLimiter = require("../helperUtils/rateLimiter");
const { createDispute, listMyDisputes, getDispute } = require("../controllers/disputesController");

const router = express.Router();
const disputesRateLimiter = createRateLimiter("disputes", 10, 30);

router.use(auth);
router.post("/", disputesRateLimiter, createDispute);
router.get("/", disputesRateLimiter, listMyDisputes);
router.get("/:id", disputesRateLimiter, getDispute);

module.exports = router;
