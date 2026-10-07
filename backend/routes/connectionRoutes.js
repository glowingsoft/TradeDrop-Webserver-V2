const express = require("express");
const auth = require("../middlewares/authMiddleware");
const createRateLimiter = require("../helperUtils/rateLimiter");
const { listConnections, getConnectionWithUser, removeConnection } = require("../controllers/connectionsController");

const router = express.Router();
const connectionsRateLimiter = createRateLimiter("connections", 10, 100);

router.use(auth);
router.get("/", connectionsRateLimiter, listConnections);
router.get("/:userId", connectionsRateLimiter, getConnectionWithUser);
router.delete("/:userId", connectionsRateLimiter, removeConnection);

module.exports = router;
