const express = require("express");
const { getPublicProfile } = require("./profileController");

const router = express.Router();

// Reserved segments used by legacy admin /users routes
const RESERVED = new Set(["coach", "athlete"]);

// Public — no JWT
router.get("/:handle", (req, res, next) => {
  if (RESERVED.has(String(req.params.handle).toLowerCase())) {
    return next("route");
  }
  return getPublicProfile(req, res, next);
});

module.exports = router;
