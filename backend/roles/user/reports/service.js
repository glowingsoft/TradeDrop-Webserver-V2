const mongoose = require("mongoose");
const UserReport = require("@models/UserReport");
const BlockedUser = require("@models/BlockedUser");
const Connection = require("@models/Connection");
const ConnectionRequest = require("@models/ConnectionRequest");
const MessageRequest = require("@models/MessageRequest");
const { User } = require("@UsersModel");
const { Drop } = require("@models/Drop");
const Circle = require("@models/Circle");
const Event = require("@models/Event");
const Message = require("@backend/commonModules/chatModule/models/Message");
const { sendUserNotifications } = require("@backend/controllers/communicationController");
const { parsePaginationParams, generateMeta } = require("@helperUtils/responseUtil");
const { withTransaction } = require("../_shared/tradeShared");
const { httpError } = require("../_shared/serialize");

const REASONS = ["harassment", "spam", "inappropriate_content", "impersonation", "scams_fraud", "other"];
const STATUSES = ["pending", "under_review", "action_taken", "dismissed", "resolved"];
const RESOURCE_TYPES = ["user", "drop", "message", "circle", "event"];

function objectId(id, key) {
  if (!mongoose.isValidObjectId(id)) throw httpError(400, key);
  return new mongoose.Types.ObjectId(id);
}

async function blockInTransaction(reporterId, reportedUserId, session) {
  const pairKey = Connection.pairKeyFor(reporterId, reportedUserId);
  const existing = await BlockedUser.findOne({ blockedBy: reporterId, blockedUser: reportedUserId }).session(session);
  if (existing) return;
  await BlockedUser.create([{ blockedBy: reporterId, blockedUser: reportedUserId }], { session });
  await Connection.updateOne({ pairKey }, { $set: { status: "removed" } }, { session });
  await Promise.all([
    ConnectionRequest.updateMany(
      { pairKey, status: "pending" },
      { $set: { status: "cancelled", respondedAt: new Date() } },
      { session },
    ),
    MessageRequest.updateMany(
      {
        $or: [
          { sender: reporterId, receiver: reportedUserId, status: "pending" },
          { sender: reportedUserId, receiver: reporterId, status: "pending" },
        ],
      },
      { $set: { status: "blocked", respondedAt: new Date() } },
      { session },
    ),
  ]);
}

async function createReport(reporterId, body = {}) {
  const reportedUserId = objectId(body.reportedUserId, "reported_user_id_invalid");
  if (String(reporterId) === String(reportedUserId)) throw httpError(400, "cannot_report_self");
  if (!REASONS.includes(body.reason)) throw httpError(400, "report_reason_invalid");
  const resourceType = body.resourceType || "user";
  if (!RESOURCE_TYPES.includes(resourceType)) throw httpError(400, "report_resource_type_invalid");
  const description = String(body.description || "").trim();
  if (description.length > 2000) throw httpError(400, "report_description_too_long");
  const resourceId = body.resourceId ? objectId(body.resourceId, "report_resource_id_invalid") : null;
  if (resourceType !== "user" && !resourceId) throw httpError(400, "report_resource_id_required");
  if (body.blockUser !== undefined && typeof body.blockUser !== "boolean") {
    throw httpError(400, "report_block_option_invalid");
  }
  if (resourceType === "user" && resourceId && String(resourceId) !== String(reportedUserId)) {
    throw httpError(400, "report_resource_target_mismatch");
  }
  const target = await User.findById(reportedUserId).select("_id deletedAt").lean();
  if (!target || target.deletedAt) throw httpError(404, "user_not_found");
  if (resourceId && resourceType !== "user") {
    const resourceModel = {
      drop: Drop,
      message: Message,
      circle: Circle,
      event: Event,
    }[resourceType];
    const resource = await resourceModel
      .findById(resourceId)
      .select(resourceType === "message" ? "senderId" : resourceType === "drop" ? "ownerId" : resourceType === "circle" ? "creatorId" : "creatorId suggestedBy")
      .lean();
    if (!resource) throw httpError(404, "report_resource_not_found");
    const ownerId =
      resourceType === "drop"
        ? resource.ownerId
        : resourceType === "message"
          ? resource.senderId
          : resourceType === "circle"
            ? resource.creatorId
            : resource.suggestedBy || resource.creatorId;
    if (String(ownerId) !== String(reportedUserId)) throw httpError(400, "report_resource_target_mismatch");
  }

  const report = await withTransaction(async (session) => {
    const [created] = await UserReport.create(
      [
        {
          reporterId,
          reportedUserId,
          reason: body.reason,
          description,
          resourceType,
          resourceId,
          blockUser: body.blockUser === true,
          history: [{ status: "pending", changedBy: reporterId }],
        },
      ],
      { session },
    );
    if (body.blockUser) await blockInTransaction(reporterId, reportedUserId, session);
    return created;
  });
  return report;
}

async function listMyReports(userId, req) {
  const { page, limit } = parsePaginationParams(req);
  const filter = { reporterId: userId };
  const [data, total] = await Promise.all([
    UserReport.find(filter)
      .select("-history")
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    UserReport.countDocuments(filter),
  ]);
  return { data, meta: generateMeta(page, limit, total) };
}

async function listReports(req, actor) {
  if (!actor.isAdmin) throw httpError(403, "access_denied");
  const { page, limit } = parsePaginationParams(req);
  const filter = {};
  if (req.query.status !== undefined) {
    if (!STATUSES.includes(req.query.status)) throw httpError(400, "report_status_invalid");
    filter.status = req.query.status;
  }
  if (req.query.reason !== undefined) {
    if (!REASONS.includes(req.query.reason)) throw httpError(400, "report_reason_invalid");
    filter.reason = req.query.reason;
  }
  const [data, total] = await Promise.all([
    UserReport.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    UserReport.countDocuments(filter),
  ]);
  return { data, meta: generateMeta(page, limit, total) };
}

async function moderateReport(reportId, actor, body = {}) {
  if (!actor.isAdmin) throw httpError(403, "access_denied");
  const id = objectId(reportId, "report_not_found");
  if (!STATUSES.includes(body.status) || body.status === "pending") throw httpError(400, "report_status_invalid");
  const note = String(body.note || "").trim();
  if (note.length > 2000) throw httpError(400, "report_note_too_long");
  const report = await UserReport.findOneAndUpdate(
    { _id: id, status: { $in: ["pending", "under_review"], $ne: body.status } },
    {
      $set: {
        status: body.status,
        assignedTo: actor._id,
        resolutionNote: ["action_taken", "dismissed", "resolved"].includes(body.status) ? note : "",
        ...( ["action_taken", "dismissed", "resolved"].includes(body.status) ? { outcomeNotifiedAt: new Date() } : {}),
      },
      $push: { history: { status: body.status, changedBy: actor._id, note } },
    },
    { new: true, runValidators: true },
  ).lean();
  if (!report) {
    if (!(await UserReport.exists({ _id: id }))) throw httpError(404, "report_not_found");
    throw httpError(409, "report_status_unchanged");
  }
  if (["action_taken", "dismissed", "resolved"].includes(report.status)) {
    sendUserNotifications({
      recipientIds: [report.reporterId],
      title: "Report reviewed",
      body: "Your report has been reviewed by TradeDrop.",
      data: { type: "report", objectType: "report" },
      objectId: report._id,
    });
  }
  return report;
}

module.exports = { createReport, listMyReports, listReports, moderateReport };
