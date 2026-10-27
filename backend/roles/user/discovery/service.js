const circleService = require("../circles/service");
const eventService = require("../events/service");
const { getAllDrops } = require("../drops/service");
const { excludedUserIds } = require("../radar/radarService");
const { dropExpiredFilter } = require("../_shared/tradeShared");
const { httpError } = require("../_shared/serialize");

async function forYou(req) {
  const { lat, lng, anywhere } = req.query;
  const isAnywhere = anywhere === "true";
  if (
    !isAnywhere &&
    (lat === undefined ||
      lng === undefined ||
      String(lat).trim() === "" ||
      String(lng).trim() === "" ||
      !Number.isFinite(Number(lat)) ||
      !Number.isFinite(Number(lng)) ||
      Number(lat) < -90 ||
      Number(lat) > 90 ||
      Number(lng) < -180 ||
      Number(lng) > 180)
  ) {
    throw httpError(400, "location_required_or_anywhere");
  }
  const excluded = req.user?._id ? await excludedUserIds(req.user._id) : [];
  const query = { ...req.query };
  if (isAnywhere) {
    delete query.lat;
    delete query.lng;
  }
  const scopedReq = { ...req, query };
  const [circles, events, drops] = await Promise.all([
    circleService.listCircles(scopedReq, { excludeUserIds: excluded }),
    eventService.listEvents(scopedReq, { excludeUserIds: excluded }),
    getAllDrops(scopedReq, {
      extraConditions: [
        { status: "open" },
        dropExpiredFilter(),
        ...(excluded.length ? [{ ownerId: { $nin: excluded } }] : []),
      ],
    }),
  ]);
  return {
    nearbyCircles: circles,
    nearbyEvents: events,
    nearbyDrops: drops,
  };
}

module.exports = { forYou };
