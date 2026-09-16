import { Router } from "express";
import { v4 as uuid } from "uuid";

import { db, admin } from "../config/firebase.js";
import {
  COLLECTIONS,
  ATTENDANCE_STATUS_VALUES, ATTENDANCE_SOURCE, GEOFENCE_RADIUS_MIN_METERS, GEOFENCE_RADIUS_MAX_METERS,
  OOO_REQUEST_STATUS,
} from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { haversineMeters, isValidCoordinate } from "../lib/geo.js";
import { eachDate } from "../lib/dateUtils.js";

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

// =====================================================================
// Daily attendance STATUS (present/absent/leave/half-day/out-of-office) —
// an integrity-controlled ledger. See constants.js for why this stays
// fully decoupled from payroll.
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

// ---- Out-of-office requests: the escape valve when a legitimate
// off-site employee fails the geofence check. Never writes an attendance
// record itself — only approval does that — so a self-check-in still
// never lets someone pick their own status unchecked.
const OOO_DOC = (id) => db.collection(COLLECTIONS.ATTENDANCE_OOO_REQUESTS).doc(id);

router.post("/ooo-requests", authenticate, async (req, res, next) => {
  try {
    const { date, reason, lat, lng } = req.body;
    if (!date || !reason) return res.status(400).json({ error: "date and reason are required" });

    const existingSnap = await db
      .collection(COLLECTIONS.ATTENDANCE_OOO_REQUESTS)
      .where("userId", "==", req.user.userId)
      .where("date", "==", date)
      .where("status", "==", OOO_REQUEST_STATUS.PENDING)
      .get();
    if (!existingSnap.empty) {
      return res.status(400).json({ error: "You already have a pending Out of Office request for this date." });
    }

    let distanceMeters = null;
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (isValidCoordinate(latNum, lngNum)) {
      const geofenceSnap = await GEOFENCE_DOC().get();
      if (geofenceSnap.exists && geofenceSnap.data().lat != null) {
        const geofence = geofenceSnap.data();
        distanceMeters = Math.round(haversineMeters(latNum, lngNum, geofence.lat, geofence.lng));
      }
    }

    const id = uuid();
    const doc = {
      userId: req.user.userId,
      name: req.user.name,
      date,
      reason,
      lat: isValidCoordinate(latNum, lngNum) ? latNum : null,
      lng: isValidCoordinate(latNum, lngNum) ? lngNum : null,
      distanceMeters,
      status: OOO_REQUEST_STATUS.PENDING,
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      requestedBy: req.user.userId,
    };
    await OOO_DOC(id).set(doc);
    res.status(201).json({ id, ...doc });
  } catch (err) {
    next(err);
  }
});

router.get("/ooo-requests/mine", authenticate, async (req, res, next) => {
  try {
    const snap = await db.collection(COLLECTIONS.ATTENDANCE_OOO_REQUESTS).where("userId", "==", req.user.userId).get();
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.date < b.date ? 1 : -1));
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.get("/ooo-requests", authenticate, requireAdmin, async (req, res, next) => {
  try {
    let query = db.collection(COLLECTIONS.ATTENDANCE_OOO_REQUESTS);
    if (req.query.status) query = query.where("status", "==", req.query.status);
    const snap = await query.get();
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.date < b.date ? 1 : -1));
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.put("/ooo-requests/:id/approve", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const ref = OOO_DOC(req.params.id);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Not found"), { status: 404 });
      const request = snap.data();
      if (request.status !== OOO_REQUEST_STATUS.PENDING) {
        throw Object.assign(new Error("Only PENDING requests can be approved"), { status: 400 });
      }

      tx.update(ref, {
        status: OOO_REQUEST_STATUS.APPROVED,
        decidedBy: req.user.userId,
        decidedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const statusRef = db.collection(COLLECTIONS.ATTENDANCE_STATUS).doc(statusDocId(request.userId, request.date));
      tx.set(statusRef, {
        userId: request.userId,
        date: request.date,
        status: ATTENDANCE_STATUS_VALUES.OUT_OF_OFFICE,
        note: request.reason,
        source: ATTENDANCE_SOURCE.SELF_OOO_REQUEST,
        markedAt: new Date().toISOString(),
        markedBy: req.user.userId,
      });
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.put("/ooo-requests/:id/reject", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const ref = OOO_DOC(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    if (snap.data().status !== OOO_REQUEST_STATUS.PENDING) {
      return res.status(400).json({ error: "Only PENDING requests can be rejected" });
    }
    await ref.update({
      status: OOO_REQUEST_STATUS.REJECTED,
      decidedBy: req.user.userId,
      decidedAt: admin.firestore.FieldValue.serverTimestamp(),
      comment: req.body.comment || null,
    });
    res.json({ ok: true });
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

const MARK_RANGE_MAX_DAYS = 31;

// Same gap-fill guarantee as mark-all-present, but across every date in a
// range (a week, a month, ...) in one call — still never touches a day that
// already has a record, whoever or whatever set it. Capped at 31 days so a
// mistaken date range can't silently touch an unbounded number of records.
router.post("/mark-all-present-range", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { fromDate, toDate } = req.body;
    if (!fromDate || !toDate) return res.status(400).json({ error: "fromDate and toDate are required" });
    if (fromDate > toDate) return res.status(400).json({ error: "fromDate must be on or before toDate" });

    const dates = [...eachDate(fromDate, toDate)];
    if (dates.length > MARK_RANGE_MAX_DAYS) {
      return res.status(400).json({ error: `Range too large — pick ${MARK_RANGE_MAX_DAYS} days or fewer at a time` });
    }

    const employees = await getActiveEmployeeProfiles();
    const targets = [];
    for (const e of employees) {
      for (const date of dates) {
        targets.push({ userId: e.userId, date, ref: db.collection(COLLECTIONS.ATTENDANCE_STATUS).doc(statusDocId(e.userId, date)) });
      }
    }

    const existsByKey = new Map();
    for (let i = 0; i < targets.length; i += 300) {
      const chunk = targets.slice(i, i + 300);
      const snaps = await db.getAll(...chunk.map((t) => t.ref));
      chunk.forEach((t, j) => existsByKey.set(`${t.userId}_${t.date}`, snaps[j].exists));
    }

    const toCreate = targets.filter((t) => !existsByKey.get(`${t.userId}_${t.date}`));

    let count = 0;
    for (let i = 0; i < toCreate.length; i += 450) {
      const chunk = toCreate.slice(i, i + 450);
      const batch = db.batch();
      for (const t of chunk) {
        batch.set(t.ref, {
          userId: t.userId,
          date: t.date,
          status: ATTENDANCE_STATUS_VALUES.PRESENT,
          note: "",
          source: ATTENDANCE_SOURCE.BULK,
          markedAt: new Date().toISOString(),
          markedBy: req.user.userId,
        });
        count++;
      }
      await batch.commit();
    }

    res.json({ ok: true, count, days: dates.length });
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

    const tallies = new Map(employees.map((e) => [e.userId, { userId: e.userId, name: e.name, PRESENT: 0, ABSENT: 0, LEAVE: 0, HALF_DAY: 0, OUT_OF_OFFICE: 0 }]));
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

export default router;
