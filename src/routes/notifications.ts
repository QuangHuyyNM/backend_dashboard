// src/routes/notifications.ts
import { Router } from "express";
import pool from "../db";
import { verifyToken } from "../middlewares/auth.middleware";

const router = Router();

// GET /api/notifications
router.get("/", verifyToken, async (req, res) => {
  try {
    const userId = (req as any).user?.sub; // lấy từ token
    const [rows]: any = await pool.query(
      `SELECT * FROM notifications WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC`,
      [userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "DB error" });
  }
});

router.post("/", verifyToken, async (req, res) => {
  try {
    const { type, title, body, meta } = req.body;
    const userId = (req as any).user?.sub;
    const [result]: any = await pool.query(
      "INSERT INTO notifications (user_id, type, title, body, meta) VALUES (?, ?, ?, ?, ?)",
      [userId || null, type, title || null, body || "", meta ? JSON.stringify(meta) : null]
    );
    const [rows]: any = await pool.query(
      "SELECT * FROM notifications WHERE id = ?",
      [result.insertId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Insert error" });
  }
});

export default router;
