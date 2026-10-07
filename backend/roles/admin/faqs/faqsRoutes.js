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

// Routes for Promo Code Management
// Create a new Promo Code
router.post("/", roleMiddleware(["admin"]), FaqsRateLimiter, createFaqs);

// Get all Promo Codes with pagination
router.get("/", roleMiddleware(["admin"]), FaqsRateLimiter, getFaqss);


// Update an existing Promo Code
router.put("/:id", roleMiddleware(["admin"]), updateFaqs);

// Delete a Promo Code
router.delete("/:id", roleMiddleware(["admin"]), deleteFaqs);

module.exports = router;
