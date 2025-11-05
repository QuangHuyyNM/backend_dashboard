// src/routes/recruitments.route.ts
import { Router, Request, Response } from "express";
import pool from "../db"; // sử dụng pool từ file db của bạn
import { requireAuth, requireRole } from "../middlewares/auth.middleware";

const router = Router();

/**
 * GET /api/recruitments
 */
router.get("/", requireAuth, async (_req: Request, res: Response) => {
  try {
    const [rows] = await pool.query("SELECT * FROM recruitments ORDER BY created_at DESC");
    res.json(rows);
  } catch (err) {
    console.error("❌ Lỗi truy vấn recruitments:", err);
    res.status(500).json({ message: "DB error" });
  }
});

/**
 * POST /api/recruitments
 * Nếu client không gửi id, backend sẽ tự tạo id dạng REC<timestamp>
 * Chỉ HR / CEO mới được thêm
 */
router.post("/", requireAuth, requireRole(["HR", "CEO"]), async (req: Request, res: Response) => {
  try {
    let { id, name, position, phone, email, status, note } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Missing required field: name" });
    }

    // tạo id tự động nếu không có
    if (!id) {
      id = `REC${Date.now()}`;
    }

    await pool.query(
      `INSERT INTO recruitments (id, name, position, phone, email, status, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [id, name, position || null, phone || null, email || null, status || "Đang xử lý", note || null]
    );

    const [rows] = await pool.query("SELECT * FROM recruitments WHERE id = ?", [id]);
    const newRec = Array.isArray(rows) && (rows as any[])[0] ? (rows as any[])[0] : null;
    res.status(201).json(newRec);
  } catch (err) {
    console.error("❌ Lỗi thêm ứng viên:", err);
    res.status(500).json({ message: "Insert error" });
  }
});

/**
 * PUT /api/recruitments/:id
 */
router.put("/:id", requireAuth, requireRole(["HR", "CEO"]), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, position, phone, email, status, note } = req.body;

    if (!id) return res.status(400).json({ message: "Missing id param" });

    await pool.query(
      `UPDATE recruitments
       SET name = ?, position = ?, phone = ?, email = ?, status = ?, note = ?, updated_at = NOW()
       WHERE id = ?`,
      [name || null, position || null, phone || null, email || null, status || null, note || null, id]
    );

    const [rows] = await pool.query("SELECT * FROM recruitments WHERE id = ?", [id]);
    const updated = Array.isArray(rows) && (rows as any[])[0] ? (rows as any[])[0] : null;
    res.json(updated);
  } catch (err) {
    console.error("❌ Lỗi cập nhật ứng viên:", err);
    res.status(500).json({ message: "Update error" });
  }
});

/**
 * DELETE /api/recruitments/:id
 */
router.delete("/:id", requireAuth, requireRole(["HR", "CEO"]), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: "Missing id param" });

    await pool.query("DELETE FROM recruitments WHERE id = ?", [id]);
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("❌ Lỗi xóa ứng viên:", err);
    res.status(500).json({ message: "Delete error" });
  }
});

export default router;
