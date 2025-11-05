// src/routes/payments.ts
import express from "express";
import pool from "../db";
import { v4 as uuidv4 } from "uuid";
import {
  requireAuth,
  requireRole,
  AuthenticatedRequest,
} from "../middlewares/auth.middleware";

const router = express.Router();

/**
 * GET /api/finance/payments
 * Query: page, limit, invoiceId, q
 * Permission: VIEW_FINANCE (or role FINANCE/ADMIN/CEO)
 */
router.get("/", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.max(1, Number(req.query.limit || 20));
    const offset = (page - 1) * limit;
    const invoiceId = req.query.invoiceId ? String(req.query.invoiceId) : null;
    const q = (req.query.q || "").toString().trim();

    let where = "WHERE 1=1";
    const params: any[] = [];

    if (invoiceId) {
      where += " AND invoice_id = ?";
      params.push(invoiceId);
    }
    if (q) {
      where += " AND (reference LIKE ? OR method LIKE ?)";
      params.push(`%${q}%`, `%${q}%`);
    }

    // Use SQL_CALC_FOUND_ROWS then SELECT FOUND_ROWS(); keep compatibility with original approach
    const [rows]: any = await pool.query(
      `SELECT SQL_CALC_FOUND_ROWS * FROM payments ${where} ORDER BY paid_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [countRows]: any = await pool.query(`SELECT FOUND_ROWS() as total`);
    const total = (countRows && countRows[0] && Number(countRows[0].total)) || 0;

    res.json({ rows, total, page, limit });
  } catch (err) {
    console.error("GET /api/finance/payments error", err);
    res.status(500).json({ message: "Lỗi server khi lấy danh sách thanh toán" });
  }
});

/**
 * POST /api/finance/payments
 * Body: { invoiceId, amount, method, reference, note, created_by }
 * Will:
 *  - insert payment
 *  - update invoice.paid_amount and status accordingly
 * Notes:
 *  - This endpoint is transactional if DB driver supports getConnection()
 *  - Accepts invoiceId or invoice_id field names
 */
router.post(
  "/",
  requireAuth,
  requireRole(["FINANCE", "ADMIN", "CEO"]),
  async (req: AuthenticatedRequest, res) => {
    let conn: any = null;
    try {
      const body = req.body || {};
      const id = body.id || `PAY-${uuidv4()}`;
      const invoiceId = body.invoiceId || body.invoice_id;
      if (!invoiceId) return res.status(400).json({ message: "invoiceId là bắt buộc" });

      const amount = Number(body.amount || 0);
      if (isNaN(amount) || amount <= 0) return res.status(400).json({ message: "amount không hợp lệ" });

      const method = body.method || body.payMethod || null;
      const reference = body.reference || null;
      const note = body.note || null;
      const created_by = body.created_by || req.user?.id || null;
      const paid_at = body.paid_at ? new Date(body.paid_at) : new Date();

      // Try to get connection for transaction (some pool implementations may not support getConnection)
      conn = (pool as any).getConnection ? await (pool as any).getConnection() : null;

      if (conn) {
        await conn.beginTransaction();

        await conn.query(
          "INSERT INTO payments (id, invoice_id, amount, paid_at, method, reference, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [id, invoiceId, amount, paid_at, method, reference, note, created_by]
        );

        // Select invoice FOR UPDATE to avoid race
        const [invRows]: any = await conn.query("SELECT * FROM invoices WHERE id = ? FOR UPDATE", [invoiceId]);
        if (!invRows || invRows.length === 0) {
          await conn.rollback();
          return res.status(404).json({ message: "Invoice not found" });
        }
        const invoice = invRows[0];
        const newPaid = Number(invoice.paid_amount || 0) + amount;
        const total = Number(invoice.total_amount || 0);
        let newStatus = invoice.status;
        if (newPaid >= total) newStatus = "PAID";
        else if (newPaid > 0) newStatus = "PARTIAL";
        else newStatus = "UNPAID";

        await conn.query("UPDATE invoices SET paid_amount = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [newPaid, newStatus, invoiceId]);

        await conn.commit();

        // fetch inserted payment for response
        const [rows]: any = await pool.query("SELECT * FROM payments WHERE id = ?", [id]);
        return res.status(201).json((rows && rows[0]) || { id });
      } else {
        // fallback without explicit transaction
        await pool.query(
          "INSERT INTO payments (id, invoice_id, amount, paid_at, method, reference, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [id, invoiceId, amount, paid_at, method, reference, note, created_by]
        );

        const [invRows]: any = await pool.query("SELECT * FROM invoices WHERE id = ?", [invoiceId]);
        if (!invRows || invRows.length === 0) return res.status(404).json({ message: "Invoice not found" });
        const invoice = invRows[0];
        const newPaid = Number(invoice.paid_amount || 0) + amount;
        const total = Number(invoice.total_amount || 0);
        let newStatus = invoice.status;
        if (newPaid >= total) newStatus = "PAID";
        else if (newPaid > 0) newStatus = "PARTIAL";
        else newStatus = "UNPAID";

        await pool.query("UPDATE invoices SET paid_amount = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [newPaid, newStatus, invoiceId]);

        const [rows]: any = await pool.query("SELECT * FROM payments WHERE id = ?", [id]);
        return res.status(201).json((rows && rows[0]) || { id });
      }
    } catch (err) {
      try {
        if (conn) await conn.rollback();
      } catch (e) {
        console.error("Rollback error", e);
      }
      console.error("POST /api/finance/payments error", err);
      res.status(500).json({ message: "Lỗi tạo payment", error: (err as any)?.message || String(err) });
    } finally {
      try {
        if (conn) conn?.release?.();
      } catch (e) {
        // ignore release errors
      }
    }
  }
);

export default router;
