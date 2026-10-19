const express = require("express");
const router = express.Router();

// Domain routers own /me/drops, /me/tap-ins and /me/trades, so they precede the generic /me router
router.use(require("../drops/routes"));
router.use(require("../tapIns/routes"));
router.use(require("../trades/routes"));
router.use(require("../disputes/routes"));
router.use("/me", require("../me/meRoutes"));
router.use("/radar", require("../radar/radarRoutes"));
router.use(require("../catalog/catalogRoutes"));
router.use("/favorites", require("../favorites/favoriteRoutes"));

module.exports = router;
