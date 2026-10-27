const { User } = require("@UsersModel");
const authRepo = require("../auth/authRepository");
const catalogRepo = require("../catalog/mongoCatalogRepository");
const { DEFAULT_RADAR_RADIUS_KM, CHIP_GROUPS } = require("./radarConstants");
const { default: mongoose } = require("mongoose");
const { parsePaginationParams, generateMeta } = require("@helperUtils/responseUtil");
const Category = require("@models/Category");
const { lookupUserCrafts, lookupUserRating } = require("@helperUtils/dbUtils/queryUtil");
const Connection = require("@models/Connection");
const ConnectionRequest = require("@models/ConnectionRequest");
const BlockedUser = require("@models/BlockedUser");
const { getAllDrops } = require("../drops/service");
const { dropExpiredFilter } = require("../_shared/tradeShared");

function AppError(translationKey, statusCode = 400) {
  const err = new Error(translationKey);
  err.translationKey = translationKey;
  err.statusCode = statusCode;
  return err;
}

function roundCoord(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 1000) / 1000;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function userChipGroups(user) {
  const groups = new Set();
  for (const craftId of user.crafts || []) {
    const cat = await catalogRepo.findCategoryById(craftId);
    if (cat?.chipGroup) groups.add(cat.chipGroup);
  }
  return groups;
}

async function matchesCategory(user, category) {
  const chip = String(category || "all")
    .toLowerCase()
    .trim();
  if (!chip || chip === "all") return true;
  if (!CHIP_GROUPS.has(chip)) return false;
  return (await userChipGroups(user)).has(chip);
}

function isRadarEligible(user) {
  if (!user || user.deletedAt) return false;
  const status = user.accountState?.status || "active";
  if (status === "banned" || status === "suspended" || status === "restricted") {
    return false;
  }
  if (!user.onboarding) return false;
  if (user.radarVisible === false) return false;
  if (user.openToTrade === false) return false;
  if (user.hideFromSearch) return false;

  return true;
}

function toPin(user) {
  return {
    _id: user._id,
    handle: user.handle || "",
    name: user.name || "",
    profileIcon: user.profileIcon || "",
    bio: user.bio || "",
    areaLabel: user.areaLabel || "",
    lat: roundCoord(user.lat),
    lng: roundCoord(user.lng),
    crafts: user.crafts || [],
    needText: user.needText || "",
    offerText: user.offerText || "",
    openToTrade: user.openToTrade !== false,
    verified: !!user.verified,
  };
}

/**
 * GET /radar — public pins. Optional viewerId excludes self.
 * Block filter deferred to slice 9.
 */
// async function listRadar(query = {}, viewerId = null) {
//   const lat = parseOptionalNumber(query.lat);
//   const lng = parseOptionalNumber(query.lng);
//   const radius = parseOptionalNumber(query.radius) ?? DEFAULT_RADAR_RADIUS_KM;
//   const area = query.area ? String(query.area).trim() : "";
//   const category = String(query.category || "all")
//     .toLowerCase()
//     .trim();

//   if (category && !CHIP_GROUPS.has(category)) {
//     throw AppError("invalid_category", 400);
//   }

//   const hasGeo = lat !== null && lng !== null;
//   if (query.radius !== undefined && query.radius !== null && query.radius !== "") {
//     if (radius === null || radius <= 0) throw AppError("invalid_radius", 400);
//   }

//   let users = (await authRepo.listAll()).filter(isRadarEligible);

//   if (viewerId) {
//     users = users.filter((u) => String(u._id) !== String(viewerId));
//   }

//   if (category && category !== "all") {
//     const next = [];
//     for (const u of users) {
//       if (await matchesCategory(u, category)) next.push(u);
//     }
//     users = next;
//   }

//   if (area) {
//     users = users.filter((u) => String(u.areaLabel || "").toLowerCase() === area.toLowerCase());
//   }

//   if (hasGeo) {
//     users = users.filter((u) => {
//       if (u.lat === null || u.lat === undefined || u.lng === null || u.lng === undefined) {
//         // No stored geo: fall back to area match if area also provided; else exclude from radius search
//         if (area) {
//           return String(u.areaLabel || "").toLowerCase() === area.toLowerCase();
//         }
//         return false;
//       }
//       return haversineKm(lat, lng, Number(u.lat), Number(u.lng)) <= radius;
//     });
//   } else if (!area) {
//     // No usable geo query and no area — return all eligible (seed-friendly guest list)
//   }

//   return users.map(toPin);
// }

async function listRadar({ req, filter = {}, recent = false }) {
  const { page, limit } = parsePaginationParams(req);
  const { radius, area, category, lat, lng, keyword } = req?.query || {};

  const viewer = req.user;
  if (!viewer?._id) {
    throw AppError("unauthorized", 401);
  }
  const parsedRadius = parseOptionalNumber(radius) ?? DEFAULT_RADAR_RADIUS_KM;
  const areaLabel = area ? String(area).trim() : "";
  const categoryValues = (Array.isArray(category) ? category : [category])
    .flatMap((value) => String(value || "all").split(","))
    .map((value) =>
      value
        .trim()
        .replace(/^[\[\]"']+|[\[\]"']+$/g, "")
        .toLowerCase(),
    )
    .filter(Boolean);
  const selectedCategories = categoryValues.filter((value) => value !== "all");
  const chipCategories = selectedCategories.filter((value) => CHIP_GROUPS.has(value));
  const categoryIds = selectedCategories.filter((value) => mongoose.Types.ObjectId.isValid(value));
  if (selectedCategories.some((value) => !CHIP_GROUPS.has(value) && !mongoose.Types.ObjectId.isValid(value))) {
    throw AppError("invalid_category", 400);
  }
  if (radius !== undefined && radius !== null && radius !== "") {
    if (parsedRadius === null || parsedRadius <= 0) {
      throw AppError("invalid_radius", 400);
    }
  }
  const hasLatitude = lat !== undefined && lat !== null && lat !== "";
  const hasLongitude = lng !== undefined && lng !== null && lng !== "";
  if (hasLatitude !== hasLongitude) throw AppError("location_invalid", 400);
  let viewerLng = null;
  let viewerLat = null;
  if (hasLatitude && hasLongitude) {
    viewerLat = parseOptionalNumber(lat);
    viewerLng = parseOptionalNumber(lng);
    if (
      viewerLat === null ||
      viewerLng === null ||
      viewerLat < -90 ||
      viewerLat > 90 ||
      viewerLng < -180 ||
      viewerLng > 180
    ) {
      throw AppError("location_invalid", 400);
    }
  }
  // if (Array.isArray(viewer.location) && viewer.location.length >= 2) {
  //   viewerLng = Number(viewer.location[0]);
  //   viewerLat = Number(viewer.location[1]);
  // } else if (viewer.lat !== null && viewer.lat !== undefined && viewer.lng !== null && viewer.lng !== undefined) {
  //   viewerLat = Number(viewer.lat);
  //   viewerLng = Number(viewer.lng);
  // }
  const hasGeo = Number.isFinite(viewerLat) && Number.isFinite(viewerLng);
  const match = {
    ...filter,
    "accountState.userType": "user",
    "accountState.status": "active",
    "verificationStatus.email": "verified",
    onboarding: true,
    radarVisible: { $ne: false },
    openToTrade: { $ne: false },
    hideFromSearch: { $ne: true },
    _id: { ...(filter._id || {}), $ne: new mongoose.Types.ObjectId(viewer._id) },
  };
  if (keyword?.trim()) {
    const expression = { $regex: escapeRegex(keyword.trim()), $options: "i" };
    match.$or = [
      { name: expression },
      { handle: expression },
      { bio: expression },
      { specialty: expression },
      { areaLabel: expression },
    ];
  }
  const blocks = await BlockedUser.find({
    $or: [{ blockedBy: viewer._id }, { blockedUser: viewer._id }],
  })
    .select("blockedBy blockedUser")
    .lean();
  const blockedIds = blocks.map((block) =>
    String(block.blockedBy) === String(viewer._id) ? block.blockedUser : block.blockedBy,
  );
  match._id.$nin = blockedIds;
  if (areaLabel) {
    match.areaLabel = { $regex: `^${escapeRegex(areaLabel)}$`, $options: "i" };
  }
  /* Category selections may be chip groups or one/more category IDs; crafts stores category IDs. */
  if (selectedCategories.length) {
    const chipCategoryDocs = chipCategories.length
      ? await Category.find({ chipGroup: { $in: chipCategories } }, { _id: 1 }).lean()
      : [];
    match.crafts = {
      $in: [
        ...categoryIds.map((id) => new mongoose.Types.ObjectId(id)),
        ...chipCategoryDocs.map((categoryDoc) => categoryDoc._id),
      ],
    };
  }
  const pipeline = [];
  /* * Geo search MUST be first. */ if (hasGeo) {
    pipeline.push({
      $geoNear: {
        near: { type: "Point", coordinates: [viewerLng, viewerLat] },
        key: "location",
        distanceField: "distanceMeters",
        maxDistance: parsedRadius * 1000,
        spherical: true,
        query: match,
      },
    });
  } else {
    pipeline.push({ $match: match });
    if (recent) pipeline.push({ $sort: { createdAt: -1, _id: -1 } });
  }
  pipeline.push({
    $facet: {
      users: [
        { $skip: (page - 1) * limit },
        { $limit: limit },
        lookupUserCrafts(),
        ...lookupUserRating(),
        {
          $project: {
            _id: 1,
            name: 1,
            handle: 1,
            profileIcon: { $concat: [process.env.S3_BASE_URL || "", "$profileIcon"] },
            areaLabel: 1,
            bio: 1,
            category: 1,
            specialty: 1,
            openToTrade: 1,
            crafts: 1,
            lat: 1,
            lng: 1,
            distanceMeters: 1,
            averageRating: 1,
            reviewCount: 1,
          },
        },
      ],
      total: [{ $count: "count" }],
    },
  });
  const [result] = await User.aggregate(pipeline);
  const total = result?.total?.[0]?.count || 0;
  const people = result?.users || [];
  const userIds = people.map((user) => user._id);
  const [connections, requests, dropIds] = await Promise.all([
    Connection.find({ status: "active", $or: [{ userA: viewer._id, userB: { $in: userIds } }, { userB: viewer._id, userA: { $in: userIds } }] })
      .select("userA userB status")
      .lean(),
    ConnectionRequest.find({
      pairKey: { $in: userIds.map((id) => Connection.pairKeyFor(viewer._id, id)) },
      status: { $in: ["pending", "declined"] },
    })
      .sort({ createdAt: -1 })
      .lean(),
    Drop.find({
      ownerId: { $in: userIds },
      status: "open",
      deletedAt: null,
      $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }],
    })
      .select("_id ownerId")
      .lean(),
  ]);
  const requestByPair = new Map();
  for (const request of requests) {
    if (!requestByPair.has(request.pairKey)) requestByPair.set(request.pairKey, request);
  }
  const connectedIds = new Set(
    connections.map((connection) =>
      String(connection.userA) === String(viewer._id) ? String(connection.userB) : String(connection.userA),
    ),
  );
  const dropsByOwner = new Map();
  for (const drop of dropIds) {
    const key = String(drop.ownerId);
    if (!dropsByOwner.has(key)) dropsByOwner.set(key, []);
    dropsByOwner.get(key).push(String(drop._id));
  }
  const data = people.map((person) => {
    const pair = Connection.pairKeyFor(viewer._id, person._id);
    const latestRequest = requestByPair.get(pair);
    const connected = connectedIds.has(String(person._id));
    const incoming = latestRequest?.status === "pending" && String(latestRequest.recipientId) === String(viewer._id);
    const outgoing = latestRequest?.status === "pending" && String(latestRequest.requesterId) === String(viewer._id);
    const inCooldown = latestRequest?.status === "declined" && latestRequest.cooldownUntil > new Date();
    return {
      ...person,
      connectionStatus: connected ? "connected" : incoming ? "incoming_request" : outgoing ? "request_sent" : latestRequest?.status === "declined" ? "declined" : "not_connected",
      canSendConnectionRequest: !connected && !incoming && !outgoing && !inCooldown,
      openDropIds: dropsByOwner.get(String(person._id)) || [],
    };
  });
  const categories = await Category.find({}, { _id: 1, name: 1 }).lean();
  const meta = generateMeta(page, limit, total);
  meta.categories = [{ _id: null, name: "All" }, ...categories];
  return {
    data,
    meta,
  };
}
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const RADAR_TAB_LIMIT = 10;

// Users the viewer must never see: blocked in either direction, plus non-active/deleted accounts
async function excludedUserIds(viewerId) {
  const [blocks, inactive] = await Promise.all([
    BlockedUser.find({ $or: [{ blockedBy: viewerId }, { blockedUser: viewerId }] })
      .select("blockedBy blockedUser")
      .lean(),
    User.find({ $or: [{ "accountState.status": { $ne: "active" } }, { deletedAt: { $ne: null } }] })
      .select("_id")
      .lean(),
  ]);
  const ids = new Set(inactive.map((u) => String(u._id)));
  for (const b of blocks) {
    ids.add(String(b.blockedBy));
    ids.add(String(b.blockedUser));
  }
  ids.delete(String(viewerId));
  return [...ids].map((id) => new mongoose.Types.ObjectId(id));
}

async function listConnectionsTab(viewerId, excluded) {
  const viewer = new mongoose.Types.ObjectId(String(viewerId));
  const filter = {
    status: "active",
    $or: [
      { userA: viewer, userB: { $nin: excluded } },
      { userB: viewer, userA: { $nin: excluded } },
    ],
  };
  const connections = await Connection.find(filter).sort({ updatedAt: -1 }).limit(RADAR_TAB_LIMIT).lean();
  const otherId = (c) => (String(c.userA) === String(viewerId) ? c.userB : c.userA);
  const users = await User.find({ _id: { $in: connections.map(otherId) } })
    .select("name handle profileIcon areaLabel")
    .lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return {
    data: connections.map((c) => ({
      _id: c._id,
      status: c.status,
      completedCount: c.completedCount || 0,
      user: byId.get(String(otherId(c))) || null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
  };
}

/**
 * GET /radar/all — the four radar tabs in one call. Each tab is isolated, so one failing
 * query returns { data: [], error } for that tab instead of failing the whole response.
 */
async function listRadarTabs(req) {
  const viewer = req.user;
  if (!viewer?._id) throw AppError("unauthorized", 401);

  const excluded = await excludedUserIds(viewer._id);
  const baseQuery = { ...(req.query || {}), page: 1, limit: RADAR_TAB_LIMIT };
  const peopleReq = (query) => ({ ...req, query });
  const peopleFilter = { deletedAt: null, _id: { $nin: excluded } };

  const { lat, lng, ...queryWithoutGeo } = baseQuery;
  const hasGeo = Number.isFinite(parseOptionalNumber(lat)) && Number.isFinite(parseOptionalNumber(lng));

  const tasks = {
    nearbyPeople: () => listRadar({ req: peopleReq(hasGeo ? baseQuery : queryWithoutGeo), filter: peopleFilter, recent: !hasGeo }),
    openDrops: () =>
      getAllDrops(peopleReq({ ...baseQuery, notme: "true" }), {
        extraConditions: [{ status: "open" }, dropExpiredFilter(), { ownerId: { $nin: excluded } }],
      }),
  };

  const names = Object.keys(tasks);
  const settled = await Promise.allSettled(names.map((name) => tasks[name]()));
  return Object.fromEntries(
    settled.map((result, i) => [
      names[i],
      result.status === "fulfilled"
        ? { data: result.value?.data || [], meta: result.value?.meta || null }
        : { data: [], meta: null, error: result.reason?.translationKey || "internal_server" },
    ]),
  );
}

module.exports = {
  listRadar,
  listRadarTabs,
  excludedUserIds,
  roundCoord,
  haversineKm,
  DEFAULT_RADAR_RADIUS_KM,
  AppError,
};
