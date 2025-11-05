"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/classStudents.ts
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const router = (0, express_1.Router)();
// GET /api/class-students -> list of rows { class_code, student_id }
router.get("/", async (_req, res) => {
    try {
        const [rows] = await db_1.default.query("SELECT * FROM class_students");
        res.json(rows);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "DB error" });
    }
});
// POST /api/class-students { class_code, student_id }
router.post("/", async (req, res) => {
    try {
        const { class_code, student_id } = req.body;
        await db_1.default.query("INSERT INTO class_students (class_code, student_id) VALUES (?, ?)", [class_code, student_id]);
        res.status(201).json({ class_code, student_id });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: err.message || "Insert error" });
    }
});
// DELETE /api/class-students (body { class_code, student_id })
router.delete("/", async (req, res) => {
    try {
        const { class_code, student_id } = req.body;
        await db_1.default.query("DELETE FROM class_students WHERE class_code = ? AND student_id = ?", [class_code, student_id]);
        res.json({ ok: true });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Delete error" });
    }
});
// optional: DELETE /api/class-students/:class_code/:student_id
router.delete("/:class_code/:student_id", async (req, res) => {
    try {
        const { class_code, student_id } = req.params;
        await db_1.default.query("DELETE FROM class_students WHERE class_code = ? AND student_id = ?", [class_code, student_id]);
        res.json({ ok: true });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Delete error" });
    }
});
exports.default = router;
