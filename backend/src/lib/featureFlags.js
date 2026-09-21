import { db } from "../config/firebase.js";
import { COLLECTIONS, FEATURE_FLAG_DEFAULTS } from "./constants.js";

const FLAGS_DOC = () => db.collection(COLLECTIONS.HR_SETTINGS).doc("feature_flags");

export async function getFeatureFlags() {
  const snap = await FLAGS_DOC().get();
  return { ...FEATURE_FLAG_DEFAULTS, ...(snap.exists ? snap.data() : {}) };
}

// Gates an entire router behind a flag — used for modules that ship
// disabled (see FEATURE_FLAG_DEFAULTS). Mounted ahead of the router itself
// in app.js, so a disabled module refuses every request under that path
// with a clean 403 rather than just hiding the buttons in the UI.
export function requireFeatureFlag(flagName) {
  return async (req, res, next) => {
    try {
      const flags = await getFeatureFlags();
      if (!flags[flagName]) {
        return res.status(403).json({ error: "This module is currently disabled." });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export { FLAGS_DOC };
