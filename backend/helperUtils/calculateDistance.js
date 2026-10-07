/**
 * Calculates distance between two coordinates using Haversine formula.
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lon1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lon2 - Longitude of point 2
 * @param {string} unit - "km" or "mi"
 * @returns {number} - Distance in given unit
 */
function calculateDistance(
  lat1,
  lng1,
  lat2,
  lng2,
  unit = "kilometer"
) {
  const toRad = (value) => (value * Math.PI) / 180;

  // -----------------------------
  // 🔒 Normalize coordinates
  // -----------------------------
  const normalize = (lat, lng) => {
    // Detect swapped values (very common)
    if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) {
      [lat, lng] = [lng, lat];
    }

    // Hard validation
    if (
      typeof lat !== "number" ||
      typeof lng !== "number" ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      return null;
    }

    return { lat, lng };
  };

  const p1 = normalize(lat1, lng1);
  const p2 = normalize(lat2, lng2);

  if (!p1 || !p2) {
    return {
      distanceKm: null,
      unit: unit === "mile" ? "mi" : "km",
    };
  }

  // -----------------------------
  // 🌍 Haversine calculation
  // -----------------------------
  const R = unit === "mile" ? 3958.8 : 6371.0;

  const dLat = toRad(p2.lat - p1.lat);
  const dLng = toRad(p2.lng - p1.lng);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(p1.lat)) *
      Math.cos(toRad(p2.lat)) *
      Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return {
    distanceKm: Number(distance.toFixed(2)),
    unit: unit === "mile" ? "mi" : "km",
  };
}

const isNullLocationCoordinates = (coords = []) => {
  if (!Array.isArray(coords) || coords.length !== 2) return true;

  const [lng, lat] = coords.map(Number);

  return (
    Number.isNaN(lng) ||
    Number.isNaN(lat) ||
    (lng === 0 && lat === 0)
  );
};

module.exports = { calculateDistance, isNullLocationCoordinates };

  