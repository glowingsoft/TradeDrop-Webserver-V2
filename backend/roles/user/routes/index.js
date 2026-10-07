const express = require("express");
const router = express.Router();

router.use("/me/drops", require("../drops/meDropsRoutes"));
router.use("/me/tap-ins", require("../tapIns/meTapInsRoutes"));
router.use("/me", require("../me/meRoutes"));
router.use("/users", require("../me/publicProfileRoutes"));
router.use("/drops", require("../drops/dropsRoutes"));
router.use("/tap-ins", require("../tapIns/tapInsRoutes"));
router.use("/trades", require("../trades/tradesRoutes"));
router.use("/radar", require("../radar/radarRoutes"));
router.use(require("../catalog/catalogRoutes"));

module.exports = router;
