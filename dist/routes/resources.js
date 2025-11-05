"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/resources.ts
const express_1 = __importDefault(require("express"));
const db_1 = __importDefault(require("../db")); // giả sử bạn có file db.ts xuất default pool (mysql2/promise)
const upload_1 = require("../middlewares/upload");
const uuid_1 = require("uuid");
const path = __importStar(require("path"));
const fs_1 = __importDefault(require("fs"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const router = express_1.default.Router();
const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 4000}`;
/**
 * GET / - list resources (pagination + filters)
 */
router.get("/", async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.max(1, Number(req.query.limit || 20));
    const q = String(req.query.q || "").trim();
    const courseId = (req.query.courseId || req.query.course_id) ?? null;
    const classCode = (req.query.classCode || req.query.class_code) ?? null;
    const offset = (page - 1) * limit;
    try {
        let where = "WHERE 1=1";
        const params = [];
        if (q) {
            where += " AND (title LIKE ? OR description LIKE ?)";
            params.push(`%${q}%`, `%${q}%`);
        }
        if (courseId) {
            where += " AND course_id = ?";
            params.push(courseId);
        }
        if (classCode) {
            where += " AND class_code = ?";
            params.push(classCode);
        }
        // Use FOUND_ROWS pattern for MySQL
        const [rows] = await db_1.default.query(`SELECT SQL_CALC_FOUND_ROWS * FROM resources ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
        const [[found]] = await db_1.default.query("SELECT FOUND_ROWS() as total");
        const totalRows = found?.total ?? 0;
        const mapped = rows.map((r) => {
            if (r.file_url && r.file_url.startsWith("/")) {
                return { ...r, file_url: `${BASE_URL}${r.file_url}` };
            }
            return r;
        });
        res.json({ rows: mapped, total: Number(totalRows), page, limit });
    }
    catch (err) {
        console.error("GET /resources error:", err);
        res.status(500).json({ message: "Lỗi server khi lấy resources" });
    }
});
/**
 * POST / - create resource
 * - multipart file (field "file") => save file and insert row
 * - JSON link (kind=link or url provided) => insert row as link
 */
router.post("/", upload_1.upload.single("file"), async (req, res) => {
    try {
        const body = req.body ?? {};
        // If link payload
        if (!req.file && (body.kind === "link" || body.url || body.link)) {
            const id = String(body.id || `RES-${(0, uuid_1.v4)()}`);
            const title = body.title || body.name || String(body.url || body.link);
            const description = body.description || null;
            const course_id = body.course_id || body.courseId || null;
            const class_code = body.class_code || body.classCode || null;
            const url = body.url || body.link || null;
            const mime_type = body.mime_type ?? null;
            const created_by = body.created_by ?? null;
            await db_1.default.query(`INSERT INTO resources (id, title, description, course_id, class_code, kind, file_url, mime_type, file_name, file_size, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, title, description, course_id, class_code, "link", url, mime_type, null, null, created_by]);
            const [rows] = await db_1.default.query("SELECT * FROM resources WHERE id = ?", [id]);
            return res.status(201).json(rows?.[0] ?? null);
        }
        // If file uploaded
        if (req.file) {
            const id = `RES-${(0, uuid_1.v4)()}`;
            const title = body.title || req.file.originalname;
            const description = body.description || null;
            const course_id = body.course_id || body.courseId || null;
            const class_code = body.class_code || body.classCode || null;
            const file_url = `/${req.file.path.replace(/\\/g, "/")}`; // will be served statically
            const mime_type = req.file.mimetype;
            const file_name = req.file.originalname;
            const file_size = req.file.size;
            const created_by = body.created_by || null;
            await db_1.default.query(`INSERT INTO resources (id, title, description, course_id, class_code, kind, file_url, mime_type, file_name, file_size, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, title, description, course_id, class_code, "file", file_url, mime_type, file_name, file_size, created_by]);
            const [rows] = await db_1.default.query("SELECT * FROM resources WHERE id = ?", [id]);
            const row = rows?.[0];
            if (row && row.file_url && row.file_url.startsWith("/"))
                row.file_url = `${BASE_URL}${row.file_url}`;
            return res.status(201).json(row ?? null);
        }
        return res.status(400).json({ message: "Yêu cầu không hợp lệ. Gửi file (multipart) hoặc link (json)." });
    }
    catch (err) {
        console.error("POST /resources error:", err);
        res.status(500).json({ message: "Lỗi server khi tạo resource" });
    }
});
/**
 * GET /:id
 */
router.get("/:id", async (req, res) => {
    try {
        const id = String(req.params.id);
        const [rows] = await db_1.default.query("SELECT * FROM resources WHERE id = ?", [id]);
        if (!rows || rows.length === 0)
            return res.status(404).json({ message: "Không tìm thấy" });
        const r = rows[0];
        if (r.file_url && r.file_url.startsWith("/"))
            r.file_url = `${BASE_URL}${r.file_url}`;
        res.json(r);
    }
    catch (err) {
        console.error("GET /resources/:id error:", err);
        res.status(500).json({ message: "Lỗi server" });
    }
});
/**
 * PUT /:id - update meta fields (title, description, course_id, class_code, tags)
 */
router.put("/:id", async (req, res) => {
    try {
        const id = String(req.params.id);
        const body = req.body ?? {};
        const editable = ["title", "description", "course_id", "class_code", "tags"];
        const updates = [];
        const params = [];
        editable.forEach((f) => {
            if (body[f] !== undefined) {
                updates.push(`${f} = ?`);
                params.push(body[f]);
            }
        });
        if (updates.length === 0)
            return res.status(400).json({ message: "Không có trường để cập nhật" });
        params.push(id);
        const sql = `UPDATE resources SET ${updates.join(", ")} WHERE id = ?`;
        await db_1.default.query(sql, params);
        const [rows] = await db_1.default.query("SELECT * FROM resources WHERE id = ?", [id]);
        const row = rows?.[0];
        if (row && row.file_url && row.file_url.startsWith("/"))
            row.file_url = `${BASE_URL}${row.file_url}`;
        res.json(row ?? null);
    }
    catch (err) {
        console.error("PUT /resources/:id error:", err);
        res.status(500).json({ message: "Lỗi server" });
    }
});
/**
 * DELETE /:id - delete resource (and local file if present)
 */
router.delete("/:id", async (req, res) => {
    try {
        const id = String(req.params.id);
        const [rows] = await db_1.default.query("SELECT * FROM resources WHERE id = ?", [id]);
        if (!rows || rows.length === 0)
            return res.status(404).json({ message: "Không tìm thấy" });
        const row = rows[0];
        if (row.file_url && row.kind === "file") {
            const filePath = row.file_url.startsWith("/") ? row.file_url.substring(1) : row.file_url;
            try {
                const resolved = path.resolve(filePath);
                if (fs_1.default.existsSync(resolved))
                    fs_1.default.unlinkSync(resolved);
            }
            catch (e) {
                // ignore file deletion error
                console.warn("Could not delete file:", e);
            }
        }
        await db_1.default.query("DELETE FROM resources WHERE id = ?", [id]);
        res.json({ success: true });
    }
    catch (err) {
        console.error("DELETE /resources/:id error:", err);
        res.status(500).json({ message: "Lỗi server" });
    }
});
exports.default = router;
