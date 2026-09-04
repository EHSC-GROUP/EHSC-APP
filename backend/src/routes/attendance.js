import { Router } from "express";

import { db, admin } from "../config/firebase.js";
import { COLLECTIONS, EXPECTED_MINUTES_PER_DAY, MAX_PING_CREDIT_MINUTES } from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";

const router = Router();

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
