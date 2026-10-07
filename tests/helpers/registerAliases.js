/**
 * Registers the same runtime module aliases as backend/server.js (@models, @helperUtils, etc.)
 * so Mocha test files can require modules that use those aliases (e.g. tapInService, controllers).
 * Loaded automatically via .mocharc.json's "require" hook.
 */
const path = require("path");
const moduleAlias = require("module-alias");
const aliases = require("../../aliasConfig/pathAliases.config");

for (const [alias, target] of Object.entries(aliases)) {
  moduleAlias.addAlias(alias, path.join(__dirname, "../..", target));
}
require("module-alias/register");
