import { Router } from "express";
import { v4 as uuid } from "uuid";

import { db, admin } from "../config/firebase.js";
import { COLLECTIONS, ROLES } from "../lib/constants.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import { uploadBuffer, streamFile, deleteFile, safeFileName } from "../lib/storage.js";

const router = Router();

router.get("/company", authenticate, async (req, res, next) => {
  try {
    const snap = await db.collection(COLLECTIONS.HR_DOCUMENTS).where("userId", "==", "ALL").get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) {
    next(err);
  }
});

router.get("/:userId", authenticate, async (req, res, next) => {
  try {
    const targetId = req.params.userId.toUpperCase();
    const isSelf = req.user.userId === targetId;
    const isAdmin = [ROLES.ADMIN, ROLES.SUPERADMIN].includes(req.user.role);
    if (!isSelf && !isAdmin) return res.status(403).json({ error: "Forbidden" });

    const snap = await db.collection(COLLECTIONS.HR_DOCUMENTS).where("userId", "==", targetId).get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) {
    next(err);
  }
});

router.post("/:userId", authenticate, requireAdmin, upload.single("file"), async (req, res, next) => {
  try {
    const targetId = req.params.userId === "ALL" ? "ALL" : req.params.userId.toUpperCase();
    if (!req.file) return res.status(400).json({ error: "file is required" });
    const { title, category } = req.body;
    if (!title) return res.status(400).json({ error: "title is required" });

    const id = uuid();
    const filePath = `documents/${targetId}/${id}-${safeFileName(req.file.originalname)}`;
    await uploadBuffer(filePath, req.file.buffer, req.file.mimetype);

    const doc = {
      userId: targetId,
      title,
      category: category || "General",
      filePath,
      fileUrl: `/api/documents/${id}/file`,
      uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
      uploadedBy: req.user.userId,
    };
    await db.collection(COLLECTIONS.HR_DOCUMENTS).doc(id).set(doc);
    res.status(201).json({ id, ...doc });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/file", authenticate, async (req, res, next) => {
  try {
    const snap = await db.collection(COLLECTIONS.HR_DOCUMENTS).doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    const doc = snap.data();
    const isAdmin = [ROLES.ADMIN, ROLES.SUPERADMIN].includes(req.user.role);
    const isSelf = doc.userId === req.user.userId;
    const isCompanyWide = doc.userId === "ALL";
    if (!isAdmin && !isSelf && !isCompanyWide) return res.status(403).json({ error: "Forbidden" });

    await streamFile(res, doc.filePath, { filename: doc.title });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.HR_DOCUMENTS).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });
    await deleteFile(snap.data().filePath);
    await ref.delete();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
