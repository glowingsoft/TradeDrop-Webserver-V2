const AuditLog = require("../models/AuditLog");

/** Records an admin/system action against an entity. Never throws — failures are logged only. */
async function writeAuditLog({ action, entity, entityId, performedBy, performedByName, oldValues, newValues }) {
  try {
    await AuditLog.create({
      action,
      entity,
      entityId,
      performedBy,
      performedByName: performedByName || "",
      oldValues: oldValues ?? null,
      newValues: newValues ?? null,
    });
  } catch (err) {
    console.error("[auditLog] failed to write audit log:", err);
  }
}

module.exports = { writeAuditLog };
