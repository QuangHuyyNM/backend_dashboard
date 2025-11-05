// src/routes/leaveRequests.ts
import { Router, Request, Response } from "express";
import pool from "../db";
import * as uuid from "uuid";  // import kiểu này tương thích CommonJS và ESM
import { requireAuth, requireRole } from "../middlewares/auth.middleware";

const router = Router();

// Không cần khai báo biến id ở đây, tạo id trong hàm POST

/**
 * GET /api/leave-requests
 * Optional query params: status, employee_id
 * Returns leave requests joined with employee name/role
 */
router.get("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const { status, employee_id } = req.query;
    const where: string[] = [];
    const params: any[] = [];

    if (status) {
      where.push("lr.status = ?");
      params.push(String(status));
    }
    if (employee_id) {
      where.push("lr.employee_id = ?");
      params.push(String(employee_id));
    }

    const sql = `
      SELECT lr.*, e.name AS employeeName, e.role AS employeeRole
      FROM leave_requests lr
      LEFT JOIN employees e ON lr.employee_id = e.id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY lr.requested_date DESC, lr.id DESC
    `;
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("leave-requests GET / error:", err);
    res.status(500).json({ message: "DB error" });
  }
});

/**
 * POST /api/leave-requests
 * Body: { id?, employee_id, leave_type?, start_date, end_date, reason? }
 * - If id not provided, generate uuid
 */
router.post("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const { id: maybeId, employee_id, leave_type, start_date, end_date, reason } = req.body || {};

    if (!employee_id || !start_date || !end_date) {
      return res.status(400).json({ message: "Thiếu trường bắt buộc: employee_id, start_date, end_date" });
    }

    // Dùng uuid.v4() thay vì uuidv4()
    const id = maybeId || uuid.v4();

    const sql = `
      INSERT INTO leave_requests (id, employee_id, leave_type, start_date, end_date, reason, status, requested_date)
      VALUES (?, ?, ?, ?, ?, ?, 'Chờ duyệt', CURDATE())
    `;
    await pool.query(sql, [id, employee_id, leave_type || null, start_date, end_date, reason || null]);

    const [rows] = await pool.query(
      `SELECT lr.*, e.name AS employeeName, e.role AS employeeRole
       FROM leave_requests lr
       LEFT JOIN employees e ON lr.employee_id = e.id
       WHERE lr.id = ?`, [id]
    );

    res.status(201).json((rows as any)[0]);
  } catch (err: any) {
    console.error("leave-requests POST / error:", err);
    // FK error / employee not exists
    if (err?.errno === 1452 || err?.code === "ER_NO_REFERENCED_ROW_2") {
      return res.status(400).json({ message: "employee_id không hợp lệ (không tồn tại trong employees)" });
    }
    res.status(500).json({ message: "Insert error" });
  }
});

/**
 * PUT /api/leave-requests/:id
 * Body: { status }  -- only HR/CEO may call
 */
router.put("/:id", requireAuth, requireRole(["HR", "CEO"]), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    const allowed = new Set(["Đã duyệt", "Bị từ chối", "Chờ duyệt"]);
    if (!status || !allowed.has(status)) {
      return res.status(400).json({ message: "Trạng thái không hợp lệ. Dùng: 'Chờ duyệt'|'Đã duyệt'|'Bị từ chối'." });
    }

    // Update
    await pool.query("UPDATE leave_requests SET status = ? WHERE id = ?", [status, id]);

    // Return updated row joined with employee info
    const [rows] = await pool.query(
      `SELECT lr.*, e.name AS employeeName, e.role AS employeeRole
       FROM leave_requests lr
       LEFT JOIN employees e ON lr.employee_id = e.id
       WHERE lr.id = ?`, [id]
    );
    const updated = (rows as any[])[0];

    // Optional: insert a notification for the employee (if notifications table exists)
    try {
      await pool.query(
        `INSERT INTO notifications (user_id, type, title, body, meta, is_read, created_at)
         VALUES (?, 'LEAVE', ?, ?, ?, 0, NOW())`,
        [
          updated?.employee_id || null,
          `Đơn nghỉ của bạn đã được cập nhật`,
          `Đơn nghỉ (${id}) đã chuyển thành: ${status}`,
          JSON.stringify({ leaveRequestId: id })
        ]
      );
    } catch (notifErr) {
      // not critical — log and continue
      console.warn("Không thể tạo notification (không ảnh hưởng tới thao tác):", notifErr);
    }

    res.json(updated);
  } catch (err) {
    console.error("leave-requests PUT /:id error:", err);
    res.status(500).json({ message: "Update error" });
  }
});

/**
 * DELETE /api/leave-requests/:id
 * (optional) — keep for completeness, only HR/CEO can delete
 */
router.delete("/:id", requireAuth, requireRole(["HR", "CEO"]), async (req: Request, res: Response) => {
  try {
    await pool.query("DELETE FROM leave_requests WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("leave-requests DELETE /:id error:", err);
    res.status(500).json({ message: "Delete error" });
  }
});

export default router;
