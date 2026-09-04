import { Router } from "express";
import { v4 as uuid } from "uuid";

import { db, admin } from "../config/firebase.js";
import { COLLECTIONS, ROLES } from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import { uploadBuffer, streamFile, deleteFile, safeFileName } from "../lib/storage.js";

const router = Router();

router.get("/:userId", authenticate, async (req, res, next) => {
  try {
    const targetId = req.params.userId.toUpperCase();
    const isSelf = req.user.userId === targetId;
    const isAdmin = [ROLES.ADMIN, ROLES.SUPERADMIN].includes(req.user.role);
    if (!isSelf && !isAdmin) return res.status(403).json({ error: "Forbidden" });

    let query = db.collection(COLLECTIONS.HR_BILLS).where("userId", "==", targetId);
    if (req.query.month) query = query.where("month", "==", req.query.month);
    const snap = await query.get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) {
    next(err);
  }
});

router.post("/:userId", authenticate, requireAdmin, upload.single("file"), async (req, res, next) => {
  try {
    const targetId = req.params.userId.toUpperCase();
    if (!req.file) return res.status(400).json({ error: "file is required" });
    const { title, month } = req.body;
    if (!title || !month) return res.status(400).json({ error: "title and month (YYYY-MM) are required" });

    const id = uuid();
    const fileId = `bills/${targetId}/${id}-${safeFileName(req.file.originalname)}`;
    await uploadBuffer(fileId, req.file.buffer, req.file.mimetype);

    const doc = {
      userId: targetId,
      month,
      title,
      fileId,
      fileUrl: `/api/bills/${id}/file`,
      uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
      uploadedBy: req.user.userId,
    };
    await db.collection(COLLECTIONS.HR_BILLS).doc(id).set(doc);
    res.status(201).json({ id, ...doc });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/file", authenticate, async (req, res, next) => {
  try {
    const snap = await db.collection(COLLECTIONS.HR_BILLS).doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    const bill = snap.data();
    const isAdmin = [ROLES.ADMIN, ROLES.SUPERADMIN].includes(req.user.role);
    const isSelf = bill.userId === req.user.userId;
    if (!isAdmin && !isSelf) return res.status(403).json({ error: "Forbidden" });
    await streamFile(res, bill.fileId, { filename: bill.title });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.HR_BILLS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    await deleteFile(snap.data().fileId);
    await ref.delete();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
