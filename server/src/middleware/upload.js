// Multer: images are kept in memory (never written to disk), max 5 MB, jpg/png/webp only.
import multer from 'multer';
import { IMAGE_MIME_TYPES, MAX_IMAGE_BYTES } from '../config/constants.js';
import { HttpError } from '../utils/httpError.js';

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_MIME_TYPES.includes(file.mimetype)) return cb(null, true);
    cb(new HttpError(415, 'Only JPG, PNG or WEBP images are accepted'));
  },
});
