// Every login/profile ID in this app (generated employee IDs, admin-typed
// Employee IDs, EHSC-EXT### associate codes) is uppercase letters, digits,
// hyphens and underscores. Route params that become a Firestore document ID
// are checked against this before use, so unexpected characters (a "/",
// say, which Firestore reads as a path separator) fail with a clean 400
// instead of being handed to the SDK.
const ID_PATTERN = /^[A-Z0-9_-]{1,64}$/;

export function isValidId(id) {
  return typeof id === "string" && ID_PATTERN.test(id);
}

// Express middleware: uppercases req.params[param] and rejects it early if
// it doesn't look like a real ID.
export function requireValidIdParam(param) {
  return (req, res, next) => {
    const value = (req.params[param] || "").toUpperCase();
    if (!isValidId(value)) return res.status(400).json({ error: `${param} is invalid` });
    req.params[param] = value;
    next();
  };
}
