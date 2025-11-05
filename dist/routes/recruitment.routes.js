"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/recruitments.route.ts
const express_1 = require("express");
const db_1 = __importDefault(require("../db")); // sử dụng pool từ file db của bạn
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
/**
 * GET /api/recruitments
 */
router.get("/", auth_middleware_1.requireAuth, async (_req, res) => {
    try {
        const [rows] = await db_1.default.query("SELECT * FROM recruitments ORDER BY created_at DESC");
        res.json(rows);
    }
    catch (err) {
        console.error("❌ Lỗi truy vấn recruitments:", err);
        res.status(500).json({ message: "DB error" });
    }
});
/**
 * POST /api/recruitments
 * Nếu client không gửi id, backend sẽ tự tạo id dạng REC<timestamp>
 * Chỉ HR / CEO mới được thêm
 */
router.post("/", auth_middleware_1.requireAuth, (0, auth_middleware_1.requireRole)(["HR", "CEO"]), async (req, res) => {
    try {
        let { id, name, position, phone, email, status, note } = req.body;
        if (!name) {
            return res.status(400).json({ message: "Missing required field: name" });
        }
        // tạo id tự động nếu không có
        if (!id) {
            id = `REC${Date.now()}`;
        }
        await db_1.default.query(`INSERT INTO recruitments (id, name, position, phone, email, status, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`, [id, name, position || null, phone || null, email || null, status || "Đang xử lý", note || null]);
        const [rows] = await db_1.default.query("SELECT * FROM recruitments WHERE id = ?", [id]);
        const newRec = Array.isArray(rows) && rows[0] ? rows[0] : null;
        res.status(201).json(newRec);
    }
    catch (err) {
        console.error("❌ Lỗi thêm ứng viên:", err);
        res.status(500).json({ message: "Insert error" });
    }
});
/**
 * PUT /api/recruitments/:id
 */
router.put("/:id", auth_middleware_1.requireAuth, (0, auth_middleware_1.requireRole)(["HR", "CEO"]), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, position, phone, email, status, note } = req.body;
        if (!id)
            return res.status(400).json({ message: "Missing id param" });
        await db_1.default.query(`UPDATE recruitments
       SET name = ?, position = ?, phone = ?, email = ?, status = ?, note = ?, updated_at = NOW()
       WHERE id = ?`, [name || null, position || null, phone || null, email || null, status || null, note || null, id]);
        const [rows] = await db_1.default.query("SELECT * FROM recruitments WHERE id = ?", [id]);
        const updated = Array.isArray(rows) && rows[0] ? rows[0] : null;
        res.json(updated);
    }
    catch (err) {
        console.error("❌ Lỗi cập nhật ứng viên:", err);
        res.status(500).json({ message: "Update error" });
    }
});
/**
 * DELETE /api/recruitments/:id
 */
router.delete("/:id", auth_middleware_1.requireAuth, (0, auth_middleware_1.requireRole)(["HR", "CEO"]), async (req, res) => {
    try {
        const { id } = req.params;
        if (!id)
            return res.status(400).json({ message: "Missing id param" });
        await db_1.default.query("DELETE FROM recruitments WHERE id = ?", [id]);
        res.json({ message: "Deleted successfully" });
    }
    catch (err) {
        console.error("❌ Lỗi xóa ứng viên:", err);
        res.status(500).json({ message: "Delete error" });
    }
});
exports.default = router;
