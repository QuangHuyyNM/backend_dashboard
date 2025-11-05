"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/systemUsers.ts
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const router = (0, express_1.Router)();
/**
 * Hệ thống user (CEO, ADMIN, IT)
 * - Bảng users (system_users) quản lý tài khoản hệ thống
 * - Employees chỉ cho HR/Teacher/TA...
 *
 * Header 'x-requester-role' dùng để giả lập quyền (CEO, ADMIN,...)
 * Sau này thay bằng req.user.role sau khi có JWT middleware.
 */
// ========== GET ALL ==========
router.get("/", async (_req, res) => {
    try {
        const [rows] = await db_1.default.query("SELECT id, name, email, role, status, created_at FROM users ORDER BY id");
        res.json(rows);
    }
    catch (err) {
        console.error("system-users GET / error:", err);
        res.status(500).json({ message: "DB error" });
    }
});
// ========== GET ONE ==========
router.get("/:id", async (req, res) => {
    try {
        const [rows] = await db_1.default.query("SELECT id, name, email, role, status, created_at FROM users WHERE id = ?", [req.params.id]);
        const arr = rows;
        if (!arr.length)
            return res.status(404).json({ message: "Not found" });
        res.json(arr[0]);
    }
    catch (err) {
        console.error("system-users GET /:id error:", err);
        res.status(500).json({ message: "DB error" });
    }
});
// ========== CREATE ==========
router.post("/", async (req, res) => {
    try {
        const { name, email, password, role = "ADMIN", status = "ACTIVE" } = req.body || {};
        if (!name || !email || !password) {
            return res
                .status(400)
                .json({ message: "Missing required fields (name, email, password)" });
        }
        const upperRole = String(role).toUpperCase();
        const requesterRole = req.headers["x-requester-role"] || null;
        if (upperRole === "CEO") {
            const [existing] = await db_1.default.query("SELECT id FROM users WHERE role = 'CEO' LIMIT 1");
            const existingArr = existing;
            if (existingArr.length > 0 && requesterRole !== "CEO") {
                return res
                    .status(403)
                    .json({ message: "CEO already exists. Only CEO can create another CEO." });
            }
        }
        const hash = await bcrypt_1.default.hash(String(password), 10);
        await db_1.default.query("INSERT INTO users (name,email,password,role,status) VALUES (?,?,?,?,?)", [name, email, hash, upperRole, status]);
        const [rows] = await db_1.default.query("SELECT id, name, email, role, status, created_at FROM users WHERE email = ?", [email]);
        res.status(201).json(rows[0]);
    }
    catch (err) {
        console.error("system-users POST error:", err);
        if (err?.code === "ER_DUP_ENTRY") {
            return res.status(409).json({ message: "Duplicate email" });
        }
        res.status(500).json({ message: err?.message || "Insert error" });
    }
});
// ========== UPDATE ==========
router.put("/:id", async (req, res) => {
    try {
        const id = req.params.id;
        const requesterRole = req.headers["x-requester-role"] || null;
        const [targetRows] = await db_1.default.query("SELECT role FROM users WHERE id = ?", [id]);
        const targetArr = targetRows;
        if (!targetArr.length)
            return res.status(404).json({ message: "Not found" });
        const updates = {};
        const allowed = new Set(["name", "email", "password", "role", "status"]);
        for (const k of Object.keys(req.body || {})) {
            if (allowed.has(k))
                updates[k] = req.body[k];
        }
        if (!Object.keys(updates).length)
            return res.status(400).json({ message: "No updatable fields provided" });
        if (updates.role && String(updates.role).toUpperCase() === "CEO") {
            const [existing] = await db_1.default.query("SELECT id FROM users WHERE role = 'CEO' LIMIT 1");
            const existingArr = existing;
            if (existingArr.length > 0 && requesterRole !== "CEO") {
                return res.status(403).json({ message: "Only CEO can assign CEO role." });
            }
        }
        const params = [];
        const sets = [];
        if (updates.password) {
            const hash = await bcrypt_1.default.hash(String(updates.password), 10);
            sets.push("password = ?");
            params.push(hash);
            delete updates.password;
        }
        for (const k of Object.keys(updates)) {
            sets.push(`${k} = ?`);
            params.push(updates[k]);
        }
        params.push(id);
        await db_1.default.query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, params);
        const [rows] = await db_1.default.query("SELECT id, name, email, role, status, created_at FROM users WHERE id = ?", [id]);
        res.json(rows[0]);
    }
    catch (err) {
        console.error("system-users PUT error:", err);
        res.status(500).json({ message: "Update error" });
    }
});
// ========== DELETE ==========
router.delete("/:id", async (req, res) => {
    try {
        const id = req.params.id;
        const requesterRole = req.headers["x-requester-role"] || null;
        const [rows] = await db_1.default.query("SELECT role FROM users WHERE id = ?", [id]);
        const arr = rows;
        if (!arr.length)
            return res.status(404).json({ message: "Not found" });
        if (arr[0].role === "CEO" && requesterRole !== "CEO") {
            return res.status(403).json({ message: "Only CEO can delete CEO account." });
        }
        await db_1.default.query("DELETE FROM users WHERE id = ?", [id]);
        res.json({ ok: true });
    }
    catch (err) {
        console.error("system-users DELETE error:", err);
        res.status(500).json({ message: "Delete error" });
    }
});
exports.default = router;
