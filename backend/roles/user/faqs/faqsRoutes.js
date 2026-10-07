const express = require("express");
const {
  createFaqs,
  getFaqss,
  updateFaqs,
  deleteFaqs,
} = require("./faqsController"); // Assuming you have a separate controller for promo codes
const createRateLimiter = require("../../../helperUtils/rateLimiter");
const auth = require("../../../middlewares/authMiddleware");
const roleMiddleware = require("../../../middlewares/roleMiddleware");

const router = express.Router();

router.use(auth);

// Create a rate limiter for Promo Codes
const FaqsRateLimiter = createRateLimiter("Faqss");

router.get("/", getFaqss);


module.exports = router;
