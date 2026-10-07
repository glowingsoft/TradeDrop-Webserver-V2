function idStr(v) {
  if (v === null || v === undefined) return v;
  return String(v);
}

function idStrOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  return String(v);
}

function mapIds(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(idStr);
}

module.exports = { idStr, idStrOrNull, mapIds };
