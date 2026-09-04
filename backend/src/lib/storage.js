import { bucket } from "../config/firebase.js";

// Every upload type (documents, bills, medical certs, generated PDFs) goes
// through these two functions and one storage bucket. Files are private —
// there is no public URL; each feature router exposes its own authorized
// `/:id/file` download route that calls streamFile() after checking the
// caller may see that specific record.

export async function uploadBuffer(storagePath, buffer, contentType) {
  const file = bucket.file(storagePath);
  await file.save(buffer, {
    metadata: { contentType },
    resumable: false,
  });
  return storagePath;
}

export async function streamFile(res, storagePath, { filename, contentType } = {}) {
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  const [metadata] = await file.getMetadata();
  res.setHeader("Content-Type", contentType || metadata.contentType || "application/octet-stream");
  if (filename) {
    res.setHeader("Content-Disposition", `inline; filename="${filename.replace(/"/g, "")}"`);
  }
  file.createReadStream().on("error", () => res.status(500).end()).pipe(res);
}

export async function deleteFile(storagePath) {
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (exists) await file.delete();
}

export function safeFileName(originalName) {
  return originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
}
