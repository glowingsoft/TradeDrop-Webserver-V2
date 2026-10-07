const { Dispute, DISPUTE_STATUSES } = require("../../../models/Dispute");
const { writeAuditLog } = require("../../../helperUtils/auditLogUtil");
const {
  sendResponse,
  validateParams,
  parsePaginationParams,
  generateMeta,
} = require("../../../helperUtils/responseUtil");

const listDisputes = async (req, res) => {
  const { page, limit } = parsePaginationParams(req);
  const filter = {};
  if (req.query.status && DISPUTE_STATUSES.includes(req.query.status)) {
    filter.status = req.query.status;
  }

  try {
    const [items, total] = await Promise.all([
      Dispute.find(filter)
        .populate("reportedBy", "name handle email")
        .populate("reportedAgainst", "name handle email")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Dispute.countDocuments(filter),
    ]);
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "disputes_fetched",
      data: items,
      meta: generateMeta(page, limit, total),
    });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, translationKey: "internal_server", error });
  }
};

const getDisputeById = async (req, res) => {
  if (!validateParams(req, res, { pathParams: ["id"], objectIdFields: ["id"] })) return;
  try {
    const dispute = await Dispute.findById(req.params.id)
      .populate("reportedBy", "name handle email")
      .populate("reportedAgainst", "name handle email")
      .populate("adminReview.reviewedBy", "name email")
      .lean();
    if (!dispute) return sendResponse({ res, statusCode: 404, translationKey: "dispute_not_found" });
    return sendResponse({ res, statusCode: 200, translationKey: "dispute_fetched", data: dispute });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, translationKey: "internal_server", error });
  }
};

async function transitionDispute(req, res, { allowedFrom, nextStatus, decision, action }) {
  if (!validateParams(req, res, { pathParams: ["id"], objectIdFields: ["id"] })) return;
  const { note = "" } = req.body || {};

  try {
    const dispute = await Dispute.findById(req.params.id);
    if (!dispute) return sendResponse({ res, statusCode: 404, translationKey: "dispute_not_found" });
    if (!allowedFrom.includes(dispute.status)) {
      return sendResponse({
        res,
        statusCode: 409,
        translationKey: "dispute_invalid_status_transition",
        values: { from: dispute.status, to: nextStatus },
      });
    }

    const oldValues = { status: dispute.status, adminReview: dispute.adminReview };

    dispute.status = nextStatus;
    if (decision) {
      dispute.adminReview = {
        reviewedBy: req.user._id,
        reviewedAt: new Date(),
        decision,
        note: String(note || ""),
      };
    } else if (note) {
      dispute.adminReview.note = String(note);
    }
    await dispute.save();

    await writeAuditLog({
      action,
      entity: "Dispute",
      entityId: dispute._id,
      performedBy: req.user._id,
      performedByName: req.user.name || "",
      oldValues,
      newValues: { status: dispute.status, adminReview: dispute.adminReview },
    });

    return sendResponse({ res, statusCode: 200, translationKey: `dispute_${action}`, data: dispute });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, translationKey: "internal_server", error });
  }
}

const startReview = (req, res) =>
  transitionDispute(req, res, {
    allowedFrom: ["pending"],
    nextStatus: "under_review",
    decision: null,
    action: "review_started",
  });

const approveDispute = (req, res) =>
  transitionDispute(req, res, {
    allowedFrom: ["pending", "under_review"],
    nextStatus: "approved",
    decision: "approved",
    action: "approved",
  });

const denyDispute = (req, res) =>
  transitionDispute(req, res, {
    allowedFrom: ["pending", "under_review"],
    nextStatus: "denied",
    decision: "denied",
    action: "denied",
  });

const resolveDispute = (req, res) =>
  transitionDispute(req, res, {
    allowedFrom: ["approved", "denied"],
    nextStatus: "resolved",
    decision: null,
    action: "resolved",
  });

module.exports = { listDisputes, getDisputeById, startReview, approveDispute, denyDispute, resolveDispute };
