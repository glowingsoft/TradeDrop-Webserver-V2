const { Dispute, DISPUTE_STATUSES } = require("../models/Dispute");
const { Drop } = require("@models/Drop");
const TapIn = require("@models/TapIn");
const { sendResponse, validateParams, parsePaginationParams, generateMeta } = require("../helperUtils/responseUtil");

/** Only allow a dispute to reference a Drop/TapIn that the reporting parties are actually involved in. */
async function validateDisputeTarget({ reportedBy, reportedAgainst, dropId, tapInId }) {
  if (!dropId && !tapInId) {
    return "dispute_target_required";
  }

  if (tapInId) {
    const tapIn = await TapIn.findById(tapInId).lean();
    if (!tapIn) return "tapin_not_found";
    const participants = [String(tapIn.ownerId), String(tapIn.applicantId)];
    if (!participants.includes(String(reportedBy))) return "not_a_tapin_participant";
    if (!participants.includes(String(reportedAgainst))) return "reported_against_not_a_tapin_participant";
    if (dropId && String(tapIn.dropId) !== String(dropId)) return "tapin_drop_mismatch";
  } else if (dropId) {
    const drop = await Drop.findById(dropId).lean();
    if (!drop) return "drop_not_found";
    if (String(drop.ownerId) !== String(reportedAgainst)) return "reported_against_not_drop_owner";
    if (String(drop.ownerId) === String(reportedBy)) return "cannot_report_own_drop";
  }

  return null;
}

const createDispute = async (req, res) => {
  if (
    !validateParams(req, res, {
      rawData: ["reportedAgainst", "reason"],
      objectIdFields: ["reportedAgainst", "drop", "tapIn"],
    })
  )
    return;

  const reportedBy = req.user._id;
  const { reportedAgainst, drop, tapIn, reason, description = "", evidence = [] } = req.body;

  if (String(reportedAgainst) === String(reportedBy)) {
    return sendResponse({ res, statusCode: 400, translationKey: "cannot_dispute_yourself" });
  }
  if (evidence && (!Array.isArray(evidence) || evidence.length > 10)) {
    return sendResponse({ res, statusCode: 400, translationKey: "evidence_max" });
  }

  try {
    const validationError = await validateDisputeTarget({
      reportedBy,
      reportedAgainst,
      dropId: drop,
      tapInId: tapIn,
    });
    if (validationError) {
      return sendResponse({ res, statusCode: 400, translationKey: validationError });
    }

    const dispute = await Dispute.create({
      reportedBy,
      reportedAgainst,
      drop: drop || null,
      tapIn: tapIn || null,
      reason: String(reason).trim(),
      description: String(description || "").trim(),
      evidence: Array.isArray(evidence) ? evidence.map(String) : [],
      status: "pending",
    });

    return sendResponse({ res, statusCode: 201, translationKey: "dispute_created", data: dispute });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, translationKey: "internal_server", error });
  }
};

const listMyDisputes = async (req, res) => {
  const { page, limit } = parsePaginationParams(req);
  const userId = req.user._id;
  const role = req.query.role === "against" ? "against" : req.query.role === "all" ? "all" : "reported";

  let filter;
  if (role === "against") filter = { reportedAgainst: userId };
  else if (role === "all") filter = { $or: [{ reportedBy: userId }, { reportedAgainst: userId }] };
  else filter = { reportedBy: userId };

  if (req.query.status && DISPUTE_STATUSES.includes(req.query.status)) {
    filter.status = req.query.status;
  }

  try {
    const [items, total] = await Promise.all([
      Dispute.find(filter)
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

const getDispute = async (req, res) => {
  if (!validateParams(req, res, { pathParams: ["id"], objectIdFields: ["id"] })) return;
  try {
    const dispute = await Dispute.findById(req.params.id).lean();
    if (!dispute) {
      return sendResponse({ res, statusCode: 404, translationKey: "dispute_not_found" });
    }
    const userId = String(req.user._id);
    const isParty = [String(dispute.reportedBy), String(dispute.reportedAgainst)].includes(userId);
    if (!isParty && req.user.userType !== "admin") {
      return sendResponse({ res, statusCode: 403, translationKey: "access_denied" });
    }
    return sendResponse({ res, statusCode: 200, translationKey: "dispute_fetched", data: dispute });
  } catch (error) {
    return sendResponse({ res, statusCode: 500, translationKey: "internal_server", error });
  }
};

module.exports = { createDispute, listMyDisputes, getDispute };
