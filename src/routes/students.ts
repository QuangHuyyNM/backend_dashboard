import { Router } from "express";
import pool from "../db";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";  // Giả sử middleware đã fix JWT

const router = Router();

// Lấy tất cả học viên
router.get("/", requireAuth, async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM students ORDER BY id");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "DB error" });
  }
});

// Lấy học viên theo class
router.get("/class/:classCode", requireAuth, async (req, res) => {
  try {
    const { classCode } = req.params;
    const [rows] = await pool.query(
      "SELECT s.* FROM class_students cs JOIN students s ON cs.student_id = s.id WHERE cs.class_code = ?",
      [classCode]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "DB error" });
  }
});

// Thêm học viên
router.post("/", requireAuth, requireRole(["HR", "ACADEMIC"]), async (req, res) => {
  try {
    const { id, name, dob, phone, profile_picture_url } = req.body;
    await pool.query("INSERT INTO students (id, name, dob, phone, profile_picture_url) VALUES (?, ?, ?, ?, ?)", 
      [id, name, dob, phone, profile_picture_url]);
    res.status(201).json({ message: "Student created" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Insert error" });
  }
});

// Cập nhật
router.put("/:id", requireAuth, requireRole(["HR", "ACADEMIC"]), async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const keys = Object.keys(fields);
    if (!keys.length) return res.status(400).json({ message: "No fields" });
    const sets = keys.map((k) => `${k}=?`).join(", ");
    const values = keys.map((k) => fields[k]);
    values.push(id);
    await pool.query(`UPDATE students SET ${sets} WHERE id=?`, values);
    res.json({ message: "Student updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Update error" });
  }
});

// Xóa
router.delete("/:id", requireAuth, requireRole(["HR"]), async (req, res) => {
  try {
    await pool.query("DELETE FROM students WHERE id=?", [req.params.id]);
    res.json({ message: "Student deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Delete error" });
  }
});

export default router;