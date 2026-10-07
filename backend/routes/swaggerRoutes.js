const express = require("express");
const swaggerUi = require("swagger-ui-express");
const openApiDocument = require("../docs/tradedropOpenApi");

const router = express.Router();

router.get("/openapi.json", (_req, res) => {
  res.json(openApiDocument);
});

router.use(
  "/",
  swaggerUi.serve,
  swaggerUi.setup(openApiDocument, {
    customSiteTitle: "TradeDrop API Docs",
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
    },
  })
);

module.exports = router;
