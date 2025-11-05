"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UPLOAD_DIR = exports.upload = void 0;
// src/middlewares/upload.ts
const multer_1 = __importDefault(require("multer"));
const fs_1 = __importDefault(require("fs"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const UPLOAD_DIR = process.env.UPLOAD_DIR || "uploads";
exports.UPLOAD_DIR = UPLOAD_DIR;
if (!fs_1.default.existsSync(UPLOAD_DIR))
    fs_1.default.mkdirSync(UPLOAD_DIR, { recursive: true });
const storage = multer_1.default.diskStorage({
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
const upload = (0, multer_1.default)({ storage });
exports.upload = upload;
exports.default = upload;
