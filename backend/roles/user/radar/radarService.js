const { User } = require("@UsersModel");
const authRepo = require("../auth/authRepository");
const catalogRepo = require("../catalog/catalogRepository");
const { DEFAULT_RADAR_RADIUS_KM, CHIP_GROUPS } = require("./radarConstants");
const { default: mongoose } = require("mongoose");
const { parsePaginationParams, generateMeta } = require("@helperUtils/responseUtil");
const Category = require("@models/Category");
const { lookupUserCrafts, lookupUserRating } = require("@helperUtils/dbUtils/queryUtil");

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
    avatarUrl: user.avatarUrl || "",
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

async function listRadar({ req, filter = {} }) {
  const { page, limit } = parsePaginationParams(req);
  const { radius, area, category, lat, lng } = req?.query || {};

  const viewer = req.user;
  if (!viewer?._id) {
    throw AppError("unauthorized", 401);
  }
  const parsedRadius = parseOptionalNumber(radius) ?? DEFAULT_RADAR_RADIUS_KM;
  const areaLabel = area ? String(area).trim() : "";
  const categoryValue = String(category || "all")
    .toLowerCase()
    .trim();
  if (categoryValue && !CHIP_GROUPS.has(categoryValue)) {
    throw AppError("invalid_category", 400);
  }
  if (radius !== undefined && radius !== null && radius !== "") {
    if (parsedRadius === null || parsedRadius <= 0) {
      throw AppError("invalid_radius", 400);
    }
  }
  let viewerLng = null;
  let viewerLat = null;
  if (lat !== undefined && lat !== null && lat !== "" && lng !== undefined && lng !== null && lng !== "") {
    viewerLat = parseOptionalNumber(lat);
    viewerLng = parseOptionalNumber(lng);
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
    _id: { ...(filter._id || {}), $ne: new mongoose.Types.ObjectId(viewer._id) },
  };
  if (areaLabel) {
    match.areaLabel = { $regex: `^${escapeRegex(areaLabel)}$`, $options: "i" };
  }
  /* * Category is stored inside crafts[]. */ if (categoryValue !== "all") {
    if (!mongoose.Types.ObjectId.isValid(categoryValue)) {
      throw AppError("invalid_category", 400);
    }
    match.crafts = new mongoose.Types.ObjectId(categoryValue);
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
            username: 1,
            handle: 1,
            profileIcon: { $concat: [process.env.S3_BASE_URL || "", "$profileIcon"] },
            areaLabel: 1,
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
  const categories = await Category.find({}, { _id: 1, name: 1 }).lean();
  const meta = generateMeta(page, limit, total);
  meta.categories = [{ _id: null, name: "All" }, ...categories];
  return {
    data: result?.users || [],
    meta,
  };
}
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
module.exports = {
  listRadar,
  roundCoord,
  haversineKm,
  DEFAULT_RADAR_RADIUS_KM,
  AppError,
};
