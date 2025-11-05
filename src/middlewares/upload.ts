// src/middlewares/upload.ts
import multer from 'multer';
import * as path from "path";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

const UPLOAD_DIR = process.env.UPLOAD_DIR || "uploads";
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (_req, file, cb) {
    const ts = Date.now();
    const sanitized = file.originalname.replace(/\s+/g, "_");
    const base = `${ts}-${sanitized}`;
    cb(null, base);
  },
});

const upload = multer({ storage });

export { upload, UPLOAD_DIR };
export default upload;
