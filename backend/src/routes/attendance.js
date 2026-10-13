import { Router } from "express";
import { v4 as uuid } from "uuid";

import { db, admin } from "../config/firebase.js";
import {
  COLLECTIONS,
  ATTENDANCE_STATUS_VALUES, ATTENDANCE_SOURCE, GEOFENCE_RADIUS_MIN_METERS, GEOFENCE_RADIUS_MAX_METERS,
  OOO_REQUEST_STATUS, STAFF_PROFILE_TYPES,
} from "../lib/constants.js";
import { authenticate, requireAdmin, requireSuperAdmin } from "../middleware/auth.js";
import { haversineMeters, isValidCoordinate } from "../lib/geo.js";
import { eachDate, weekdayOf } from "../lib/dateUtils.js";
import { getHolidaySetForRange, getWeeklyOffDays } from "../lib/calendar.js";

const router = Router();

const GEOFENCE_DOC = () => db.collection(COLLECTIONS.HR_SETTINGS).doc("attendance_geofence");
const statusDocId = (userId, date) => `${userId}_${date}`;

async function getActiveEmployeeProfiles() {
  const [profilesSnap, usersSnap] = await Promise.all([
    db.collection(COLLECTIONS.HR_EMPLOYEE_PROFILES).where("type", "in", STAFF_PROFILE_TYPES).get(),
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

// Only the superadmin marks/edits a status directly (admins can still approve
// requests, but never set Present/LOP themselves).
router.post("/mark-status", authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { userId, date, status, note, leaveTypeId } = req.body;
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
      // Which leave type this day is — cosmetic/descriptive only (this
      // ledger deliberately stays decoupled from the real leave-balance
      // system in hr_leave_requests, see note above).
      leaveTypeId: status === ATTENDANCE_STATUS_VALUES.LEAVE ? leaveTypeId || null : null,
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

router.get("/geofence", authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const snap = await GEOFENCE_DOC().get();
    res.json(snap.exists ? snap.data() : null);
  } catch (err) {
    next(err);
  }
});

router.put("/geofence", authenticate, requireSuperAdmin, async (req, res, next) => {
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
    const existing = await ref.get();
    if (existing.exists && existing.data().startTime) {
      // An approved part-day Work From Home / On Duty: keep it, and just record
      // that they also checked in at the office for the rest of the day.
      await ref.update({ checkedInAt: new Date().toISOString(), distanceMeters: Math.round(distanceMeters) });
    } else {
      await ref.set({
        userId: req.user.userId,
        date,
        status: ATTENDANCE_STATUS_VALUES.PRESENT,
        note: "",
        source: ATTENDANCE_SOURCE.SELF_GEOFENCE,
        markedAt: new Date().toISOString(),
        markedBy: req.user.userId,
        checkedInAt: new Date().toISOString(),
        distanceMeters: Math.round(distanceMeters),
      });
    }

    res.json({ ok: true, distanceMeters: Math.round(distanceMeters) });
  } catch (err) {
    next(err);
  }
});

// Self checkout uses the same server-side geofence validation as check-in.
// It only updates a PRESENT record created for the current day and never
// changes the attendance status itself.
router.post("/check-out", authenticate, async (req, res, next) => {
  try {
    const { date, lat, lng } = req.body;
    const today = new Date().toISOString().slice(0, 10);
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (date !== today || !isValidCoordinate(latNum, lngNum)) {
      return res.status(400).json({ error: "A valid current-day date and lat/lng are required" });
    }

    const geofenceSnap = await GEOFENCE_DOC().get();
    if (!geofenceSnap.exists || !geofenceSnap.data().enabled) {
      return res.status(400).json({ error: "Self check-out isn't available. Ask your admin to mark your attendance." });
    }
    const geofence = geofenceSnap.data();
    const distanceMeters = haversineMeters(latNum, lngNum, geofence.lat, geofence.lng);
    if (distanceMeters > geofence.radiusMeters) {
      return res.status(403).json({
        error: `You're ${Math.round(distanceMeters)}m from the office — check-out requires being within ${geofence.radiusMeters}m.`,
        distanceMeters: Math.round(distanceMeters),
        radiusMeters: geofence.radiusMeters,
      });
    }

    const ref = db.collection(COLLECTIONS.ATTENDANCE_STATUS).doc(statusDocId(req.user.userId, date));
    const snap = await ref.get();
    if (!snap.exists || (snap.data().status !== ATTENDANCE_STATUS_VALUES.PRESENT && !(snap.data().startTime && snap.data().checkedInAt))) {
      return res.status(400).json({ error: "You must check in at the office before checking out." });
    }
    if (snap.data().checkedOutAt) {
      return res.status(400).json({ error: "You have already checked out today." });
    }

    await ref.update({
      checkedOutAt: new Date().toISOString(),
      checkOutLat: latNum,
      checkOutLng: lngNum,
      checkOutDistanceMeters: Math.round(distanceMeters),
    });

    res.json({ ok: true, distanceMeters: Math.round(distanceMeters) });
  } catch (err) {
    next(err);
  }
});

// ---- Date-range requests: On Duty, Work From Home and Travel -------------
// Each is requested for a From..To range (the same day twice for a single
// day), today or in advance, and only an approval ever writes attendance
// records — so nobody can pick their own status unchecked. Approving marks
// every working day in the range (holidays and weekly-offs are left alone).
const MAX_RANGE_DAYS = 31;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (d) => typeof d === "string" && ISO_DAY.test(d) && !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime());
const addIsoDays = (d, n) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

// {from, to} from the body (fromDate/toDate, or the older single `date`).
function parseRange(body, label) {
  const today = new Date().toISOString().slice(0, 10);
  const from = body.fromDate || body.date || today;
  const to = body.toDate || from;
  if (!validDay(from) || !validDay(to)) return { error: "Dates must be valid (YYYY-MM-DD)" };
  if (from < today) return { error: `${label} can only be requested from today onwards` };
  if (to < from) return { error: "The To date can't be before the From date" };
  if (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`) > (MAX_RANGE_DAYS - 1) * 86400000) {
    return { error: `Please request ${MAX_RANGE_DAYS} days or fewer at a time` };
  }
  return { from, to };
}

// The days in a range that an approval should actually mark.
async function markableDates(from, to) {
  const [holidays, weeklyOff] = await Promise.all([getHolidaySetForRange(from, to), getWeeklyOffDays()]);
  return [...eachDate(from, to)].filter((d) => !holidays.has(d) && !weeklyOff.includes(weekdayOf(d)));
}

async function createRangeRequest(req, res, next, { collection, label, extra }) {
  try {
    const range = parseRange(req.body, label);
    if (range.error) return res.status(400).json({ error: range.error });
    const { from, to } = range;
    if ((await markableDates(from, to)).length === 0) {
      return res.status(400).json({ error: "Those dates are all holidays or weekly offs — pick working days" });
    }

    // One pending request at a time for any overlapping days.
    const pending = await db.collection(collection).where("userId", "==", req.user.userId).where("status", "==", OOO_REQUEST_STATUS.PENDING).get();
    const overlap = pending.docs.some((d) => d.data().date <= to && (d.data().toDate || d.data().date) >= from);
    if (overlap) return res.status(400).json({ error: `You already have a pending ${label} request that overlaps these dates.` });

    const id = uuid();
    const doc = {
      userId: req.user.userId,
      name: req.user.name,
      date: from,
      toDate: to,
      ...(extra ? extra(req) : {}),
      status: OOO_REQUEST_STATUS.PENDING,
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      requestedBy: req.user.userId,
    };
    await db.collection(collection).doc(id).set(doc);
    res.status(201).json({ id, ...doc });
  } catch (err) {
    next(err);
  }
}

async function listRangeRequests(req, res, next, { collection, mineOnly }) {
  try {
    let query = db.collection(collection);
    if (mineOnly) query = query.where("userId", "==", req.user.userId);
    else if (req.query.status) query = query.where("status", "==", req.query.status);
    const snap = await query.get();
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.date < b.date ? 1 : -1));
    res.json(list);
  } catch (err) {
    next(err);
  }
}

// `statusRecord(request)` is what gets written for each marked day.
async function approveRangeRequest(req, res, next, { collection, statusRecord, allowOwn }) {
  try {
    const ref = db.collection(collection).doc(req.params.id);
    const pre = await ref.get();
    if (!pre.exists) return res.status(404).json({ error: "Not found" });
    const dates = await markableDates(pre.data().date, pre.data().toDate || pre.data().date);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Not found"), { status: 404 });
      const request = snap.data();
      if (request.status !== OOO_REQUEST_STATUS.PENDING) {
        throw Object.assign(new Error("Only PENDING requests can be approved"), { status: 400 });
      }
      if (!allowOwn && request.userId === req.user.userId) {
        throw Object.assign(new Error("You can't approve your own request"), { status: 403 });
      }
      tx.update(ref, {
        status: OOO_REQUEST_STATUS.APPROVED,
        decidedBy: req.user.userId,
        decidedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      for (const date of dates) {
        tx.set(db.collection(COLLECTIONS.ATTENDANCE_STATUS).doc(statusDocId(request.userId, date)), {
          userId: request.userId,
          date,
          ...statusRecord(request),
          markedAt: new Date().toISOString(),
          markedBy: req.user.userId,
        });
      }
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

async function rejectRangeRequest(req, res, next, { collection, allowOwn }) {
  try {
    const ref = db.collection(collection).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    if (snap.data().status !== OOO_REQUEST_STATUS.PENDING) {
      return res.status(400).json({ error: "Only PENDING requests can be rejected" });
    }
    if (!allowOwn && snap.data().userId === req.user.userId) {
      return res.status(403).json({ error: "You can't reject your own request" });
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
}

// ---- On Duty (formerly Out of Office): needs hours and a reason; approved
// by the superadmin. Also the escape valve when a legitimate off-site
// employee fails the geofence check.
const OOO_COL = COLLECTIONS.ATTENDANCE_OOO_REQUESTS;
const minutesOf = (t) => (/^\d{2}:\d{2}$/.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : NaN);

router.post("/ooo-requests", authenticate, async (req, res, next) => {
  const { startTime, endTime, reason, lat, lng } = req.body;
  if (!startTime || !endTime || !reason) {
    return res.status(400).json({ error: "dates, startTime, endTime and reason are required" });
  }
  const s = minutesOf(startTime);
  const e = minutesOf(endTime);
  if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || s > 1439 || e < 1 || e > 1439 || s >= e) {
    return res.status(400).json({ error: "startTime and endTime must be valid, and endTime must be later than startTime" });
  }
  let distanceMeters = null;
  const latNum = Number(lat);
  const lngNum = Number(lng);
  const hasCoords = isValidCoordinate(latNum, lngNum);
  if (hasCoords) {
    try {
      const geofenceSnap = await GEOFENCE_DOC().get();
      if (geofenceSnap.exists && geofenceSnap.data().lat != null) {
        const g = geofenceSnap.data();
        distanceMeters = Math.round(haversineMeters(latNum, lngNum, g.lat, g.lng));
      }
    } catch (err) {
      return next(err);
    }
  }
  return createRangeRequest(req, res, next, {
    collection: OOO_COL,
    label: "On Duty",
    extra: () => ({ startTime, endTime, reason, lat: hasCoords ? latNum : null, lng: hasCoords ? lngNum : null, distanceMeters }),
  });
});
router.get("/ooo-requests/mine", authenticate, (req, res, next) => listRangeRequests(req, res, next, { collection: OOO_COL, mineOnly: true }));
router.get("/ooo-requests", authenticate, requireSuperAdmin, (req, res, next) => listRangeRequests(req, res, next, { collection: OOO_COL }));
router.put("/ooo-requests/:id/approve", authenticate, requireSuperAdmin, (req, res, next) => approveRangeRequest(req, res, next, {
  collection: OOO_COL,
  allowOwn: true,
  statusRecord: (r) => ({ status: ATTENDANCE_STATUS_VALUES.OUT_OF_OFFICE, note: r.reason, source: ATTENDANCE_SOURCE.SELF_OOO_REQUEST, startTime: r.startTime, endTime: r.endTime }),
}));
router.put("/ooo-requests/:id/reject", authenticate, requireSuperAdmin, (req, res, next) => rejectRangeRequest(req, res, next, { collection: OOO_COL, allowOwn: true }));
router.put("/ooo-requests/:id/cancel", authenticate, async (req, res, next) => {
  try {
    const ref = db.collection(OOO_COL).doc(req.params.id);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("Not found"), { status: 404 });
      const request = snap.data();
      if (request.userId !== req.user.userId && req.user.role !== "superadmin") {
        throw Object.assign(new Error("Forbidden"), { status: 403 });
      }
      if (![OOO_REQUEST_STATUS.PENDING, OOO_REQUEST_STATUS.APPROVED].includes(request.status)) {
        throw Object.assign(new Error("Only pending or approved On Duty requests can be cancelled"), { status: 400 });
      }
      tx.update(ref, {
        status: OOO_REQUEST_STATUS.CANCELLED,
        cancelledBy: req.user.userId,
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      if (request.status === OOO_REQUEST_STATUS.APPROVED) {
        const dates = await markableDates(request.date, request.toDate || request.date);
        for (const date of dates) {
          tx.delete(db.collection(COLLECTIONS.ATTENDANCE_STATUS).doc(statusDocId(request.userId, date)));
        }
      }
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- Travel: an employee asking in advance to be marked Travel (e.g. an
// on-site client visit). Approved by an admin.
const TRAVEL_COL = COLLECTIONS.ATTENDANCE_TRAVEL_REQUESTS;
router.post("/travel-requests", authenticate, (req, res, next) => {
  if (!req.body.reason) return res.status(400).json({ error: "dates and reason are required" });
  return createRangeRequest(req, res, next, { collection: TRAVEL_COL, label: "Travel", extra: (r) => ({ reason: r.body.reason }) });
});
router.get("/travel-requests/mine", authenticate, (req, res, next) => listRangeRequests(req, res, next, { collection: TRAVEL_COL, mineOnly: true }));
router.get("/travel-requests", authenticate, requireAdmin, (req, res, next) => listRangeRequests(req, res, next, { collection: TRAVEL_COL }));
router.put("/travel-requests/:id/approve", authenticate, requireAdmin, (req, res, next) => approveRangeRequest(req, res, next, {
  collection: TRAVEL_COL,
  allowOwn: true,
  statusRecord: (r) => ({ status: ATTENDANCE_STATUS_VALUES.TRAVEL, note: r.reason, source: ATTENDANCE_SOURCE.SELF_TRAVEL_REQUEST }),
}));
router.put("/travel-requests/:id/reject", authenticate, requireAdmin, (req, res, next) => rejectRangeRequest(req, res, next, { collection: TRAVEL_COL, allowOwn: true }));

// ---- Work From Home: one tap, no description. Approved by an admin, and
// nobody approves their own request.
const WFH_COL = COLLECTIONS.ATTENDANCE_WFH_REQUESTS;
// Optional hours let someone work from home for only part of the day (the rest
 // in the office, or on duty). No hours = the whole day.
router.post("/wfh-requests", authenticate, (req, res, next) => {
  const { startTime, endTime } = req.body;
  if (startTime || endTime) {
    const s = minutesOf(startTime || "");
    const e = minutesOf(endTime || "");
    if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || s > 1439 || e < 1 || e > 1439 || s >= e) {
      return res.status(400).json({ error: "Give both a start and an end time, with the end later than the start (or leave both empty for the whole day)" });
    }
  }
  return createRangeRequest(req, res, next, {
    collection: WFH_COL,
    label: "Work From Home",
    extra: () => (startTime && endTime ? { startTime, endTime } : {}),
  });
});
router.get("/wfh-requests/mine", authenticate, (req, res, next) => listRangeRequests(req, res, next, { collection: WFH_COL, mineOnly: true }));
router.get("/wfh-requests", authenticate, requireAdmin, (req, res, next) => listRangeRequests(req, res, next, { collection: WFH_COL }));
router.put("/wfh-requests/:id/approve", authenticate, requireAdmin, (req, res, next) => approveRangeRequest(req, res, next, {
  collection: WFH_COL,
  allowOwn: false,
  statusRecord: (r) => ({
    status: ATTENDANCE_STATUS_VALUES.WFH,
    note: r.startTime ? `Part-day: ${r.startTime} - ${r.endTime}` : "",
    source: ATTENDANCE_SOURCE.SELF_WFH_REQUEST,
    ...(r.startTime ? { startTime: r.startTime, endTime: r.endTime } : {}),
  }),
}));
router.put("/wfh-requests/:id/reject", authenticate, requireAdmin, (req, res, next) => rejectRangeRequest(req, res, next, { collection: WFH_COL, allowOwn: false }));

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
        leaveTypeId: record?.leaveTypeId || null,
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
router.post("/mark-all-present", authenticate, requireSuperAdmin, async (req, res, next) => {
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
router.post("/mark-all-present-range", authenticate, requireSuperAdmin, async (req, res, next) => {
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

    const tallies = new Map(employees.map((e) => [e.userId, { userId: e.userId, name: e.name, PRESENT: 0, ABSENT: 0, LEAVE: 0, HALF_DAY: 0, OUT_OF_OFFICE: 0, TRAVEL: 0, WFH: 0 }]));
    for (const doc of snap.docs) {
      const r = doc.data();
      const entry = tallies.get(r.userId);
      if (entry && entry[r.status] !== undefined) entry[r.status] += 1;
    }
    // Present-equivalent total — same definition Form 22 and the payslip
    // muster grid use (see attendanceQuery.js's PRESENT_EQUIVALENT): an
    // approved Out of Office or Travel day counts as present, same as a
    // plain check-in or a half day.
    const result = [...tallies.values()].map((t) => ({
      ...t,
      PRESENT_EQUIVALENT: t.PRESENT + t.HALF_DAY + t.OUT_OF_OFFICE + t.TRAVEL + t.WFH,
    }));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
