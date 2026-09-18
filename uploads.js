// uploads.js — handles profile photo and product photo uploads.
//
// Files are saved to /public/uploads and served as static files. This is
// fine for getting started, but local disk fills up and doesn't survive
// redeploys on most hosts. Once you have real traffic, swap the storage
// engine below for an S3-compatible bucket (Cloudinary, AWS S3,
// Backblaze B2 all work) — the rest of the app only cares about the URL
// that comes back, so the change stays contained to this file.

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const uploadDir = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`),
});

const ALLOWED = ['.jpg', '.jpeg', '.png', '.webp'];
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ALLOWED.includes(ext));
  },
});

function urlFor(req, filename) {
  return `${req.protocol}://${req.get('host')}/uploads/${filename}`;
}

module.exports = { upload, urlFor };
