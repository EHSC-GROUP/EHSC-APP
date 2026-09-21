import multer from "multer";

const ALLOWED_EXTENSIONS = /\.(jpg|jpeg|png|webp|pdf)$/i;
const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30MB

// Checked alongside the extension — a browser sets this from the file's
// actual declared type, so a file renamed to end in .jpg but whose
// Content-Type claims something else (e.g. text/html) is rejected instead
// of being stored and later served back with an attacker-chosen type.
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

function fileFilter(req, file, cb) {
  if (!ALLOWED_EXTENSIONS.test(file.originalname)) {
    cb(new Error("Only .jpg, .jpeg, .png, .webp, .pdf files are allowed"));
    return;
  }
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(new Error("Only .jpg, .jpeg, .png, .webp, .pdf files are allowed"));
    return;
  }
  cb(null, true);
}

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter,
});
