  const express = require("express");
const router = express.Router();

//common routes
router.use("/", require("./index"));
router.use("/conversations", require("../commonModules/chatModule/routes/messageRoutes"));
module.exports = router;