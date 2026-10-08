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

// Error shape consumed by the controllers' handleError (statusCode + translationKey)
function httpError(statusCode, translationKey) {
  const err = new Error(translationKey);
  err.statusCode = statusCode;
  err.translationKey = translationKey;
  return err;
}

module.exports = { idStr, idStrOrNull, mapIds, httpError };
