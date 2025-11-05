// src/routes/classStudents.ts
import { Router } from "express";
import pool from "../db";
const router = Router();

// GET /api/class-students -> list of rows { class_code, student_id }
router.get("/", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM class_students");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "DB error" });
  }
});

// POST /api/class-students { class_code, student_id }
router.post("/", async (req, res) => {
  try {
    const { class_code, student_id } = req.body;
    await pool.query("INSERT INTO class_students (class_code, student_id) VALUES (?, ?)", [class_code, student_id]);
    res.status(201).json({ class_code, student_id });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ message: err.message || "Insert error" });
  }
});

// DELETE /api/class-students (body { class_code, student_id })
router.delete("/", async (req, res) => {
  try {
    const { class_code, student_id } = req.body;
    await pool.query("DELETE FROM class_students WHERE class_code = ? AND student_id = ?", [class_code, student_id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Delete error" });
  }
});

// optional: DELETE /api/class-students/:class_code/:student_id
router.delete("/:class_code/:student_id", async (req, res) => {
  try {
    const { class_code, student_id } = req.params;
    await pool.query("DELETE FROM class_students WHERE class_code = ? AND student_id = ?", [class_code, student_id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Delete error" });
  }
});

export default router;
