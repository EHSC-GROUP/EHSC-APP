import multer from "multer";

const ALLOWED_EXTENSIONS = /\.(jpg|jpeg|png|webp|pdf)$/i;
const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30MB

function fileFilter(req, file, cb) {
  if (!ALLOWED_EXTENSIONS.test(file.originalname)) {
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
