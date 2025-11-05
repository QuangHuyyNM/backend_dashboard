// src/routes/appointments.ts
import { Router } from "express";
import pool from "../db";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requirePermission, AuthenticatedRequest } from "../middlewares/auth.middleware";

const router = Router();

/**
 * GET /api/admissions/appointments
 */
router.get("/", requireAuth, requirePermission("VIEW_CRM"), async (req: AuthenticatedRequest, res) => {
  try {
    const {
      page = "1",
      limit = "20",
      q,
      dateFrom,
      dateTo,
      status,
      assigned_to,
      upcoming
    } = req.query as Record<string, string | undefined>;

    const pageNum = Math.max(1, parseInt(String(page) || "1"));
    const limitNum = Math.max(1, parseInt(String(limit) || "20"));
    const offset = (pageNum - 1) * limitNum;

    const where: string[] = ["a.deleted = 0"];
    const params: (string | number)[] = [];

    if (q && q.trim()) {
      where.push("(a.lead_id LIKE ? OR l.name LIKE ? OR l.phone LIKE ?)");
      const like = `%${q.trim()}%`;
      params.push(like, like, like);
    }
    if (status && status.trim()) {
      where.push("a.status = ?");
      params.push(status.trim());
    }
    if (assigned_to && assigned_to.trim()) {
      where.push("a.assigned_to = ?");
      params.push(assigned_to.trim());
    }
    if (dateFrom) {
      where.push("a.`date` >= ?");
      params.push(dateFrom);
    }
    if (dateTo) {
      where.push("a.`date` <= ?");
      params.push(dateTo);
    }
    if (upcoming === "true") {
      where.push("a.status = 'pending' AND a.`date` >= CURDATE()");
    }

    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const dataQuery = `
      SELECT a.*, l.name as lead_name, l.phone as lead_phone, l.source as lead_source
      FROM appointments a
      LEFT JOIN leads l ON l.id = a.lead_id
      ${whereSQL}
      ORDER BY a.\`date\` ASC, a.\`time\` ASC
      LIMIT ? OFFSET ?
    `;
    const [rows]: any = await pool.query(dataQuery, [...params, limitNum, offset]);

    const countQuery = `
      SELECT COUNT(*) as total
      FROM appointments a
      LEFT JOIN leads l ON l.id = a.lead_id
      ${whereSQL}
    `;
    const [countRows]: any = await pool.query(countQuery, params);
    const total = (countRows && countRows[0] && Number(countRows[0].total)) || 0;

    res.json({ rows: rows || [], total, page: pageNum, limit: limitNum });
  } catch (err: any) {
    console.error("[appointments][GET /] error:", err);
    res.status(500).json({ message: "DB error", error: err?.message || String(err) });
  }
});

/**
 * GET /api/admissions/appointments/:id
 */
router.get("/:id", requireAuth, requirePermission("VIEW_CRM"), async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id;
    const [rows]: any = await pool.query(
      `SELECT a.*, l.name as lead_name, l.phone as lead_phone, l.source as lead_source
       FROM appointments a
       LEFT JOIN leads l ON l.id = a.lead_id
       WHERE a.id = ? AND a.deleted = 0`, [id]
    );
    if (!rows || rows.length === 0) return res.status(404).json({ message: "Không tìm thấy lịch hẹn" });
    res.json(rows[0]);
  } catch (err: any) {
    console.error("[appointments][GET /:id] error:", err);
    res.status(500).json({ message: "DB error", error: err?.message || String(err) });
  }
});

/**
 * POST /api/admissions/appointments
 */
router.post("/", requireAuth, requirePermission("EDIT_CRM"), async (req: AuthenticatedRequest, res) => {
  try {
    const { lead_id, assigned_to, date, time, type = "call", location, notes } = req.body || {};
    // validate date/time basic
    if (!date || !time) return res.status(400).json({ message: "date và time là bắt buộc" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: "date phải theo định dạng YYYY-MM-DD" });
    if (!/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ message: "time phải theo định dạng HH:mm" });

    const id = `APPT-${uuidv4()}`;
    const created_by = req.user?.id || null;

    await pool.query(
      `INSERT INTO appointments (id, lead_id, assigned_to, \`date\`, \`time\`, \`type\`, location, notes, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [id, lead_id || null, assigned_to || null, date, time, type, location || null, notes || null, created_by]
    );

    const [rows]: any = await pool.query(
      `SELECT a.*, l.name as lead_name, l.phone as lead_phone FROM appointments a LEFT JOIN leads l ON l.id = a.lead_id WHERE a.id = ?`, [id]
    );
    res.status(201).json({ message: "Lịch hẹn tạo thành công", appointment: (rows && rows[0]) || null });
  } catch (err: any) {
    console.error("[appointments][POST /] error:", err);
    res.status(500).json({ message: "Insert error", error: err?.message || String(err) });
  }
});

/**
 * PUT /api/admissions/appointments/:id
 */
router.put("/:id", requireAuth, requirePermission("EDIT_CRM"), async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id;
    const fields = req.body || {};
    const allowed = ["lead_id", "assigned_to", "date", "time", "type", "location", "notes", "status"];
    const keys = Object.keys(fields).filter(k => allowed.includes(k));
    if (keys.length === 0) return res.status(400).json({ message: "No valid fields to update" });

    // validate date/time when present
    if (fields.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(fields.date))) {
      return res.status(400).json({ message: "date phải theo định dạng YYYY-MM-DD" });
    }
    if (fields.time && !/^\d{2}:\d{2}$/.test(String(fields.time))) {
      return res.status(400).json({ message: "time phải theo định dạng HH:mm" });
    }

    const sets = keys.map(k => `\`${k}\` = ?`).join(", ");
    const values = keys.map(k => (fields as any)[k]);
    values.push(id);

    const [result]: any = await pool.query(`UPDATE appointments SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
    if (!result || result.affectedRows === 0) return res.status(404).json({ message: "Không tìm thấy lịch hẹn" });

    const [rows]: any = await pool.query(`SELECT a.*, l.name as lead_name, l.phone as lead_phone FROM appointments a LEFT JOIN leads l ON l.id = a.lead_id WHERE a.id = ?`, [id]);
    res.json({ message: "Cập nhật thành công", appointment: (rows && rows[0]) || null });
  } catch (err: any) {
    console.error("[appointments][PUT /:id] error:", err);
    res.status(500).json({ message: "Update error", error: err?.message || String(err) });
  }
});

/**
 * POST /api/admissions/appointments/:id/status
 */
router.post("/:id/status", requireAuth, requirePermission("EDIT_CRM"), async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body || {};
    if (!["pending","completed","cancelled"].includes(status)) return res.status(400).json({ message: "Status không hợp lệ" });

    const [result]: any = await pool.query("UPDATE appointments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [status, id]);
    if (!result || result.affectedRows === 0) return res.status(404).json({ message: "Không tìm thấy lịch hẹn" });

    res.json({ message: "Status updated" });
  } catch (err: any) {
    console.error("[appointments][POST /:id/status] error:", err);
    res.status(500).json({ message: "Update status error", error: err?.message || String(err) });
  }
});

/**
 * DELETE /api/admissions/appointments/:id (soft)
 */
router.delete("/:id", requireAuth, requirePermission("EDIT_CRM"), async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id;
    const [result]: any = await pool.query("UPDATE appointments SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
    if (!result || result.affectedRows === 0) return res.status(404).json({ message: "Không tìm thấy lịch hẹn" });
    res.json({ message: "Đã xóa lịch hẹn (soft)" });
  } catch (err: any) {
    console.error("[appointments][DELETE /:id] error:", err);
    res.status(500).json({ message: "Delete error", error: err?.message || String(err) });
  }
});

export default router;
