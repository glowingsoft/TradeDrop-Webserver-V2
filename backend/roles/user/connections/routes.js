const express = require("express");
const c = require("./controller");
const { gated } = require("../_shared/authGates");

const router = express.Router();

router.post("/connection-requests", ...gated, c.create);
router.get("/connection-requests/incoming", ...gated, c.incoming);
router.get("/connection-requests/outgoing", ...gated, c.outgoing);
router.post("/connection-requests/:id/accept", ...gated, c.accept);
router.post("/connection-requests/:id/decline", ...gated, c.decline);
router.post("/connection-requests/:id/withdraw", ...gated, c.withdraw);
router.get("/me/network", ...gated, c.network);

module.exports = router;
