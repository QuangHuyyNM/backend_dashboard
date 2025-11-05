"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/notifications.ts
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
// GET /api/notifications
router.get("/", auth_middleware_1.verifyToken, async (req, res) => {
    try {
        const userId = req.user?.sub; // lấy từ token
        const [rows] = await db_1.default.query(`SELECT * FROM notifications WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC`, [userId]);
        res.json(rows);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "DB error" });
    }
});
router.post("/", auth_middleware_1.verifyToken, async (req, res) => {
    try {
        const { type, title, body, meta } = req.body;
        const userId = req.user?.sub;
        const [result] = await db_1.default.query("INSERT INTO notifications (user_id, type, title, body, meta) VALUES (?, ?, ?, ?, ?)", [userId || null, type, title || null, body || "", meta ? JSON.stringify(meta) : null]);
        const [rows] = await db_1.default.query("SELECT * FROM notifications WHERE id = ?", [result.insertId]);
        res.status(201).json(rows[0]);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Insert error" });
    }
});
exports.default = router;
