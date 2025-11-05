"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/courses.ts
const express_1 = require("express");
const db_1 = __importDefault(require("../db")); // Ensure this is properly configured
const router = (0, express_1.Router)();
/**
 * Columns in DB: id, name, target, level, category, tuition_fee, sessions, description, created_at, updated_at
 * We return tuition_fee aliased as tuitionFee for convenience, but frontend also tolerates tuition_fee.
 */
// GET /api/courses
router.get("/", async (_req, res) => {
    try {
        const [rows] = await db_1.default.query(`SELECT id, name, target, level, category,
              tuition_fee AS tuitionFee, sessions, description,
              created_at, updated_at
       FROM courses
       ORDER BY created_at DESC`);
        res.json(rows);
    }
    catch (err) {
        console.error("GET /courses error", err);
        res.status(500).json({ message: "DB error" });
    }
});
// GET /api/courses/:id
router.get("/:id", async (req, res) => {
    try {
        const id = req.params.id;
        const [rows] = await db_1.default.query(`SELECT id, name, target, level, category,
              tuition_fee AS tuitionFee, sessions, description,
              created_at, updated_at
       FROM courses WHERE id = ? LIMIT 1`, [id]);
        const arr = rows;
        if (!arr.length)
            return res.status(404).json({ message: "Not found" });
        res.json(arr[0]);
    }
    catch (err) {
        console.error("GET /courses/:id error", err);
        res.status(500).json({ message: "DB error" });
    }
});
// POST /api/courses
router.post("/", async (req, res) => {
    try {
        const { id, name, target, level = null, category, tuitionFee = 0, sessions = 0, description = null } = req.body || {};
        if (!id || !name || !target || !category) {
            return res.status(400).json({ message: "Missing required fields: id, name, target, category" });
        }
        const sql = `INSERT INTO courses
      (id, name, target, level, category, tuition_fee, sessions, description)
      VALUES (?,?,?,?,?,?,?,?)`;
        await db_1.default.query(sql, [id, name, target, level, category, Number(tuitionFee), Number(sessions), description]);
        const [rows] = await db_1.default.query(`SELECT id, name, target, level, category, tuition_fee AS tuitionFee, sessions, description, created_at, updated_at FROM courses WHERE id = ?`, [id]);
        res.status(201).json(rows[0]);
    }
    catch (err) {
        console.error("POST /courses error", err);
        if (err?.code === "ER_DUP_ENTRY") {
            return res.status(409).json({ message: "Course id already exists" });
        }
        res.status(500).json({ message: err?.message || "Insert error" });
    }
});
// PUT /api/courses/:id
router.put("/:id", async (req, res) => {
    try {
        const id = req.params.id;
        // Check if the course exists
        const [existRows] = await db_1.default.query("SELECT id FROM courses WHERE id = ? LIMIT 1", [id]);
        if (!existRows.length)
            return res.status(404).json({ message: "Not found" });
        // Allowed updates
        const allowed = new Set(["name", "target", "level", "category", "tuitionFee", "sessions", "description"]);
        const updates = {};
        for (const k of Object.keys(req.body || {})) {
            if (allowed.has(k))
                updates[k] = req.body[k];
        }
        if (!Object.keys(updates).length)
            return res.status(400).json({ message: "No updatable fields provided" });
        // Build query mapping tuitionFee -> tuition_fee
        const sets = [];
        const params = [];
        for (const k of Object.keys(updates)) {
            if (k === "tuitionFee") {
                sets.push("tuition_fee = ?");
                params.push(Number(updates[k] ?? 0));
            }
            else {
                sets.push(`${k} = ?`);
                params.push(updates[k]);
            }
        }
        const sql = `UPDATE courses SET ${sets.join(", ")} WHERE id = ?`;
        params.push(id);
        await db_1.default.query(sql, params);
        const [rows] = await db_1.default.query(`SELECT id, name, target, level, category, tuition_fee AS tuitionFee, sessions, description, created_at, updated_at FROM courses WHERE id = ?`, [id]);
        res.json(rows[0]);
    }
    catch (err) {
        console.error("PUT /courses/:id error", err);
        res.status(500).json({ message: "Update error" });
    }
});
// DELETE /api/courses/:id
router.delete("/:id", async (req, res) => {
    try {
        const id = req.params.id;
        const [rows] = await db_1.default.query("SELECT id FROM courses WHERE id = ? LIMIT 1", [id]);
        if (!rows.length)
            return res.status(404).json({ message: "Not found" });
        await db_1.default.query("DELETE FROM courses WHERE id = ?", [id]);
        res.json({ ok: true });
    }
    catch (err) {
        console.error("DELETE /courses/:id error", err);
        res.status(500).json({ message: "Delete error" });
    }
});
exports.default = router;
