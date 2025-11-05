"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// backend/src/routes/qaRoutes.ts
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
/**
 * GET /api/qa/questions
 * returns array of questions (simple list)
 */
router.get("/questions", auth_middleware_1.requireAuth, async (req, res) => {
    try {
        const [rows] = await db_1.default.query("SELECT * FROM qa_questions ORDER BY created_at DESC");
        // parse tags for each row
        const list = (rows || []).map((r) => ({
            ...r,
            tags: r.tags ? safeParseTags(r.tags) : [],
        }));
        res.json({ rows: list });
    }
    catch (err) {
        console.error("GET /qa/questions error", err);
        res.status(500).json({ message: "Lỗi server khi lấy câu hỏi" });
    }
});
/**
 * GET /api/qa/questions/:id
 */
router.get("/questions/:id", auth_middleware_1.requireAuth, async (req, res) => {
    try {
        const id = req.params.id;
        const [rows] = await db_1.default.query("SELECT * FROM qa_questions WHERE id = ?", [id]);
        if (!rows || rows.length === 0)
            return res.status(404).json({ message: "Không tìm thấy câu hỏi" });
        const q = rows[0];
        const [answers] = await db_1.default.query("SELECT * FROM qa_answers WHERE question_id = ? ORDER BY created_at ASC", [id]);
        q.tags = q.tags ? safeParseTags(q.tags) : [];
        q.answers = answers || [];
        res.json(q);
    }
    catch (err) {
        console.error("GET /qa/questions/:id error", err);
        res.status(500).json({ message: "Lỗi server" });
    }
});
/**
 * POST /api/qa/questions
 */
router.post("/questions", auth_middleware_1.requireAuth, async (req, res) => {
    try {
        const { title, content, class_code, course_id, tags } = req.body;
        if (!title || !content)
            return res.status(400).json({ message: "Tiêu đề và nội dung bắt buộc" });
        const created_by = req.user?.id ?? null;
        if (!created_by)
            return res.status(401).json({ message: "Không xác định người dùng" });
        const id = `Q-${Date.now()}`;
        const now = new Date();
        const row = {
            id,
            title,
            content,
            class_code: class_code || null,
            course_id: course_id || null,
            tags: JSON.stringify(tags || []),
            status: "OPEN",
            created_by,
            created_at: now,
        };
        await db_1.default.query("INSERT INTO qa_questions SET ?", row);
        // return created record in consistent shape
        const created = { ...row, tags: tags || [] };
        res.status(201).json(created);
    }
    catch (err) {
        console.error("POST /qa/questions error", err);
        res.status(500).json({ message: "Lỗi server khi tạo câu hỏi" });
    }
});
/**
 * PUT /api/qa/questions/:id
 * Update by owner
 */
router.put("/questions/:id", auth_middleware_1.requireAuth, async (req, res) => {
    try {
        const id = req.params.id;
        const { title, content, tags } = req.body;
        const userId = req.user?.id;
        const [rows] = await db_1.default.query("SELECT * FROM qa_questions WHERE id = ?", [id]);
        if (!rows || rows.length === 0)
            return res.status(404).json({ message: "Không tìm thấy" });
        const q = rows[0];
        if (String(q.created_by) !== String(userId))
            return res.status(403).json({ message: "Bạn không có quyền sửa" });
        await db_1.default.query("UPDATE qa_questions SET title = ?, content = ?, tags = ? WHERE id = ?", [title ?? q.title, content ?? q.content, JSON.stringify(tags || safeParseTags(q.tags) || []), id]);
        res.json({ message: "Cập nhật thành công" });
    }
    catch (err) {
        console.error("PUT /qa/questions/:id error", err);
        res.status(500).json({ message: "Lỗi server" });
    }
});
/**
 * DELETE /api/qa/questions/:id
 * Only allowed for roles (ACADEMIC, CEO)
 */
router.delete("/questions/:id", auth_middleware_1.requireAuth, (0, auth_middleware_1.requireRole)(["ACADEMIC", "CEO"]), async (req, res) => {
    try {
        const id = req.params.id;
        const [result] = await db_1.default.query("DELETE FROM qa_questions WHERE id = ?", [id]);
        if (result.affectedRows === 0)
            return res.status(404).json({ message: "Không tìm thấy" });
        // delete answers
        await db_1.default.query("DELETE FROM qa_answers WHERE question_id = ?", [id]);
        res.status(204).send();
    }
    catch (err) {
        console.error("DELETE /qa/questions/:id error", err);
        res.status(500).json({ message: "Lỗi server" });
    }
});
/**
 * POST /api/qa/answers
 */
router.post("/answers", auth_middleware_1.requireAuth, (0, auth_middleware_1.requireRole)(["TEACHER", "ACADEMIC", "CEO"]), async (req, res) => {
    try {
        const { question_id, content } = req.body;
        if (!question_id || !content)
            return res.status(400).json({ message: "Thiếu question_id hoặc content" });
        const created_by = req.user?.id;
        if (!created_by)
            return res.status(401).json({ message: "Không xác định người dùng" });
        const id = `A-${Date.now()}`;
        const now = new Date();
        const row = { id, question_id, content, created_by, created_at: now };
        await db_1.default.query("INSERT INTO qa_answers SET ?", row);
        await db_1.default.query("UPDATE qa_questions SET status = ? WHERE id = ?", ["ANSWERED", question_id]);
        res.status(201).json(row);
    }
    catch (err) {
        console.error("POST /qa/answers error", err);
        res.status(500).json({ message: "Lỗi server khi thêm trả lời" });
    }
});
/**
 * DELETE /api/qa/answers/:id
 */
router.delete("/answers/:id", auth_middleware_1.requireAuth, (0, auth_middleware_1.requireRole)(["TEACHER", "ACADEMIC", "CEO"]), async (req, res) => {
    try {
        const id = req.params.id;
        const [result] = await db_1.default.query("DELETE FROM qa_answers WHERE id = ?", [id]);
        if (result.affectedRows === 0)
            return res.status(404).json({ message: "Không tìm thấy answer" });
        res.status(204).send();
    }
    catch (err) {
        console.error("DELETE /qa/answers/:id error", err);
        res.status(500).json({ message: "Lỗi server" });
    }
});
function safeParseTags(v) {
    if (!v)
        return [];
    if (Array.isArray(v))
        return v;
    try {
        return JSON.parse(v);
    }
    catch (e) {
        return String(v).split(",").map((t) => t.trim()).filter(Boolean);
    }
}
exports.default = router;
