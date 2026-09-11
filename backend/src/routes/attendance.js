import { Router } from "express";

import { db, admin } from "../config/firebase.js";
import {
  COLLECTIONS, EXPECTED_MINUTES_PER_DAY, MAX_PING_CREDIT_MINUTES,
  ATTENDANCE_STATUS_VALUES, ATTENDANCE_SOURCE, GEOFENCE_RADIUS_MIN_METERS, GEOFENCE_RADIUS_MAX_METERS,
} from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { haversineMeters, isValidCoordinate } from "../lib/geo.js";

const router = Router();

const GEOFENCE_DOC = () => db.collection(COLLECTIONS.HR_SETTINGS).doc("attendance_geofence");
const statusDocId = (userId, date) => `${userId}_${date}`;

async function getActiveEmployeeProfiles() {
  const [profilesSnap, usersSnap] = await Promise.all([
    db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).where("type", "==", "employee").get(),
    db.collection(COLLECTIONS.USERS).get(),
  ]);
  const usersById = new Map(usersSnap.docs.map((d) => [d.id, d.data()]));
  return profilesSnap.docs
    .map((d) => ({ userId: d.id, name: usersById.get(d.id)?.name || d.id, disabled: !!usersById.get(d.id)?.disabled }))
    .filter((p) => !p.disabled);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function docId(userId, date) {
  return `${userId}_${date}`;
}

// Close any dangling IN_PROGRESS session from a previous day, using its
// last heartbeat (or login time, if it never received one) as the
// effective logout — no extra credit for the gap while it sat open.
async function closeStaleOpenSessions(userId, todayDate) {
  const snap = await db
    .collection(COLLECTIONS.ATTENDANCE_LOGS)
    .where("userId", "==", userId)
    .where("status", "==", "IN_PROGRESS")
    .get();

  for (const doc of snap.docs) {
    if (doc.id === docId(userId, todayDate)) continue;
    const data = doc.data();
    const sessions = data.sessions || [];
    const last = sessions[sessions.length - 1];
    if (last && !last.logoutTime) {
      last.logoutTime = last.lastPingAt || last.loginTime;
    }
    await doc.ref.update({
      sessions,
      status: "COMPLETED",
      autoClosedStale: true,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
}

router.post("/login", authenticate, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const date = todayISO();
    await closeStaleOpenSessions(userId, date);

    const ref = db.collection(COLLECTIONS.ATTENDANCE_LOGS).doc(docId(userId, date));
    const now = new Date().toISOString();

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const newSession = { loginTime: now, logoutTime: null, durationMinutes: 0, lastPingAt: now };

      if (!snap.exists) {
        tx.set(ref, {
          userId,
          name: req.user.name,
          role: req.user.role,
          date,
          sessions: [newSession],
          totalMinutes: 0,
          expectedMinutes: EXPECTED_MINUTES_PER_DAY,
          status: "IN_PROGRESS",
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          lastActivityAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        const data = snap.data();
        const sessions = data.sessions || [];
        if (data.status !== "IN_PROGRESS") {
          sessions.push(newSession);
        }
        tx.update(ref, {
          sessions,
          status: "IN_PROGRESS",
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          lastActivityAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Periodic activity ping. Credits real elapsed time since the last ping,
// capped at MAX_PING_CREDIT_MINUTES per ping — this is what prevents a
// sleeping laptop from counting its whole closed-lid duration as worked.
router.post("/ping", authenticate, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const date = todayISO();
    const ref = db.collection(COLLECTIONS.ATTENDANCE_LOGS).doc(docId(userId, date));

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data().status !== "IN_PROGRESS") {
        throw Object.assign(new Error("No active session. Log in first."), { status: 400 });
      }
      const data = snap.data();
      const sessions = data.sessions || [];
      const last = sessions[sessions.length - 1];
      const now = new Date();
      const lastPing = new Date(last.lastPingAt || last.loginTime);
      const elapsedMinutes = Math.max(0, (now - lastPing) / 60000);
      const credit = Math.min(elapsedMinutes, MAX_PING_CREDIT_MINUTES);

      last.durationMinutes = Math.round(((last.durationMinutes || 0) + credit) * 100) / 100;
      last.lastPingAt = now.toISOString();

      const totalMinutes = Math.round(sessions.reduce((s, sess) => s + (sess.durationMinutes || 0), 0) * 100) / 100;

      tx.update(ref, {
        sessions,
        totalMinutes,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        lastActivityAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Always closes the caller's own session, from their auth token — never an
// arbitrary userId from the request body.
router.post("/logout", authenticate, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const date = todayISO();
    const ref = db.collection(COLLECTIONS.ATTENDANCE_LOGS).doc(docId(userId, date));

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data().status !== "IN_PROGRESS") return;
      const data = snap.data();
      const sessions = data.sessions || [];
      const last = sessions[sessions.length - 1];
      const now = new Date().toISOString();
      if (last) last.logoutTime = now;

      tx.update(ref, {
        sessions,
        status: "COMPLETED",
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/me", authenticate, async (req, res, next) => {
  try {
    const month = req.query.month; // YYYY-MM
    let query = db.collection(COLLECTIONS.ATTENDANCE_LOGS).where("userId", "==", req.user.userId);
    if (month) query = query.where("date", ">=", `${month}-01`).where("date", "<=", `${month}-31`);
    const snap = await query.get();
    res.json(snap.docs.map((d) => d.data()).sort((a, b) => (a.date < b.date ? -1 : 1)));
  } catch (err) {
    next(err);
  }
});

// Admin: view any employee's attendance.
router.get("/summary", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const month = req.query.month;
    if (!month) return res.status(400).json({ error: "month (YYYY-MM) is required" });
    const snap = await db
      .collection(COLLECTIONS.ATTENDANCE_LOGS)
      .where("date", ">=", `${month}-01`)
      .where("date", "<=", `${month}-31`)
      .get();

    const byUser = new Map();
    for (const doc of snap.docs) {
      const d = doc.data();
      const entry = byUser.get(d.userId) || { userId: d.userId, name: d.name, daysPresent: 0, totalMinutes: 0 };
      if ((d.totalMinutes || 0) > 0) entry.daysPresent += 1;
      entry.totalMinutes += d.totalMinutes || 0;
      byUser.set(d.userId, entry);
    }
    res.json([...byUser.values()]);
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// Daily attendance STATUS (present/absent/leave/half-day) — an
// integrity-controlled ledger, distinct from the login/logout time-clock
// above. See constants.js for why this stays fully decoupled from payroll.
// =====================================================================

// Admin marks anyone's (or their own) status directly.
router.post("/mark-status", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { userId, date, status, note } = req.body;
    if (!date || !status) return res.status(400).json({ error: "date and status are required" });
    if (!Object.values(ATTENDANCE_STATUS_VALUES).includes(status)) {
      return res.status(400).json({ error: `status must be one of ${Object.values(ATTENDANCE_STATUS_VALUES).join(", ")}` });
    }

    const targetUserId = userId ? userId.toUpperCase() : req.user.userId;
    if (targetUserId !== req.user.userId) {
      const targetSnap = await db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).doc(targetUserId).get();
      if (!targetSnap.exists) return res.status(404).json({ error: "Employee not found" });
    }

    const ref = db.collection(COLLECTIONS.ATTENDANCE_STATUS).doc(statusDocId(targetUserId, date));
    await ref.set({
      userId: targetUserId,
      date,
      status,
      note: note || "",
      source: ATTENDANCE_SOURCE.ADMIN,
      markedAt: new Date().toISOString(),
      markedBy: req.user.userId,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/geofence", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const snap = await GEOFENCE_DOC().get();
    res.json(snap.exists ? snap.data() : null);
  } catch (err) {
    next(err);
  }
});

router.put("/geofence", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { lat, lng, radiusMeters, enabled } = req.body;
    if (!isValidCoordinate(Number(lat), Number(lng))) {
      return res.status(400).json({ error: "lat/lng must be valid coordinates" });
    }
    const radius = Number(radiusMeters);
    if (!Number.isFinite(radius) || radius < GEOFENCE_RADIUS_MIN_METERS || radius > GEOFENCE_RADIUS_MAX_METERS) {
      return res.status(400).json({ error: `radiusMeters must be between ${GEOFENCE_RADIUS_MIN_METERS} and ${GEOFENCE_RADIUS_MAX_METERS}` });
    }

    await GEOFENCE_DOC().set({
      lat: Number(lat),
      lng: Number(lng),
      radiusMeters: radius,
      enabled: !!enabled,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.userId,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Any member can check whether self check-in is available and how close
// they need to be — but never see the actual office coordinates here.
router.get("/geofence-status", authenticate, async (req, res, next) => {
  try {
    const snap = await GEOFENCE_DOC().get();
    if (!snap.exists) return res.json({ enabled: false, radiusMeters: null });
    const data = snap.data();
    res.json({ enabled: !!data.enabled, radiusMeters: data.radiusMeters ?? null });
  } catch (err) {
    next(err);
  }
});

// Self check-in — always the caller's own userId, never an override from
// the body. Fails closed whenever geofencing isn't configured/enabled; the
// distance check runs server-side against the stored office coordinates,
// never trusting a claimed distance or pass/fail from the client.
router.post("/check-in", authenticate, async (req, res, next) => {
  try {
    const { date, lat, lng } = req.body;
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!date || !isValidCoordinate(latNum, lngNum)) {
      return res.status(400).json({ error: "date and valid lat/lng are required" });
    }

    const geofenceSnap = await GEOFENCE_DOC().get();
    if (!geofenceSnap.exists || !geofenceSnap.data().enabled) {
      return res.status(400).json({ error: "Self check-in isn't available. Ask your admin to mark your attendance." });
    }
    const geofence = geofenceSnap.data();

    const distanceMeters = haversineMeters(latNum, lngNum, geofence.lat, geofence.lng);
    if (distanceMeters > geofence.radiusMeters) {
      return res.status(403).json({
        error: `You're ${Math.round(distanceMeters)}m from the office — check-in requires being within ${geofence.radiusMeters}m.`,
        distanceMeters: Math.round(distanceMeters),
        radiusMeters: geofence.radiusMeters,
      });
    }

    const ref = db.collection(COLLECTIONS.ATTENDANCE_STATUS).doc(statusDocId(req.user.userId, date));
    await ref.set({
      userId: req.user.userId,
      date,
      status: ATTENDANCE_STATUS_VALUES.PRESENT,
      note: "",
      source: ATTENDANCE_SOURCE.SELF_GEOFENCE,
      markedAt: new Date().toISOString(),
      markedBy: req.user.userId,
      distanceMeters: Math.round(distanceMeters),
    });

    res.json({ ok: true, distanceMeters: Math.round(distanceMeters) });
  } catch (err) {
    next(err);
  }
});

// Caller's own daily-status history for one month. Queried by userId only
// and filtered/sorted in JS, so it never needs a composite Firestore index.
router.get("/my-status", authenticate, async (req, res, next) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const snap = await db.collection(COLLECTIONS.ATTENDANCE_STATUS).where("userId", "==", req.user.userId).get();
    const list = snap.docs.map((d) => d.data()).filter((r) => r.date.startsWith(month));
    list.sort((a, b) => (a.date < b.date ? 1 : -1));
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// Every active employee's status for one day — roster + that day's
// records, fetched in parallel and joined in JS.
router.get("/roster", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const employees = await getActiveEmployeeProfiles();
    const refs = employees.map((e) => db.collection(COLLECTIONS.ATTENDANCE_STATUS).doc(statusDocId(e.userId, date)));
    const snaps = refs.length ? await db.getAll(...refs) : [];

    const roster = employees.map((e, i) => {
      const record = snaps[i]?.exists ? snaps[i].data() : null;
      return {
        userId: e.userId,
        name: e.name,
        status: record?.status || null,
        source: record?.source || null,
        note: record?.note || "",
      };
    });
    res.json({ date, roster });
  } catch (err) {
    next(err);
  }
});

// Marks PRESENT/BULK for every active employee who has no record yet for
// this date — never touches anyone who already has an entry (whether
// present, absent, leave, or half-day), so admins only ever have to
// manually correct the actual exceptions.
router.post("/mark-all-present", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { date } = req.body;
    if (!date) return res.status(400).json({ error: "date is required" });

    const employees = await getActiveEmployeeProfiles();
    const refs = employees.map((e) => db.collection(COLLECTIONS.ATTENDANCE_STATUS).doc(statusDocId(e.userId, date)));
    const snaps = refs.length ? await db.getAll(...refs) : [];

    const batch = db.batch();
    let count = 0;
    employees.forEach((e, i) => {
      if (snaps[i]?.exists) return; // already has a record — never overwrite
      batch.set(refs[i], {
        userId: e.userId,
        date,
        status: ATTENDANCE_STATUS_VALUES.PRESENT,
        note: "",
        source: ATTENDANCE_SOURCE.BULK,
        markedAt: new Date().toISOString(),
        markedBy: req.user.userId,
      });
      count++;
    });
    if (count > 0) await batch.commit();

    res.json({ ok: true, count });
  } catch (err) {
    next(err);
  }
});

// Per-person status tallies across a month, for every currently-active
// team member.
router.get("/status-summary", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const month = req.query.month;
    if (!month) return res.status(400).json({ error: "month (YYYY-MM) is required" });

    const [employees, snap] = await Promise.all([
      getActiveEmployeeProfiles(),
      db.collection(COLLECTIONS.ATTENDANCE_STATUS).where("date", ">=", `${month}-01`).where("date", "<=", `${month}-31`).get(),
    ]);

    const tallies = new Map(employees.map((e) => [e.userId, { userId: e.userId, name: e.name, PRESENT: 0, ABSENT: 0, LEAVE: 0, HALF_DAY: 0 }]));
    for (const doc of snap.docs) {
      const r = doc.data();
      const entry = tallies.get(r.userId);
      if (entry && entry[r.status] !== undefined) entry[r.status] += 1;
    }
    res.json([...tallies.values()]);
  } catch (err) {
    next(err);
  }
});

router.get("/:userId", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const userId = req.params.userId.toUpperCase();
    const month = req.query.month;
    let query = db.collection(COLLECTIONS.ATTENDANCE_LOGS).where("userId", "==", userId);
    if (month) query = query.where("date", ">=", `${month}-01`).where("date", "<=", `${month}-31`);
    const snap = await query.get();
    res.json(snap.docs.map((d) => d.data()).sort((a, b) => (a.date < b.date ? -1 : 1)));
  } catch (err) {
    next(err);
  }
});

export default router;
