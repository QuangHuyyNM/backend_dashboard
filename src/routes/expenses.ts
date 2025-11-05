// src/routes/expenses.ts
import express from "express";
import pool from "../db";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requirePermission } from "../middlewares/auth.middleware";

const router = express.Router();

// Helper: normalize expense row
function normalizeExpenseRow(r: any) {
  if (!r) return null;
  return {
    id: r.id,
    category: r.category || "",
    description: r.description || "",
    amount: Number(r.amount || 0),
    occurred_at: r.occurred_at ? String(r.occurred_at).slice(0, 10) : "",
    created_by: r.created_by || "",
    created_at: r.created_at || null,
  };
}

/**
 * GET /api/finance/expenses
 * query: month, year, page, limit
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const qMonth = req.query.month ? Number(req.query.month) : null;
    const qYear = req.query.year ? Number(req.query.year) : null;
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
    const offset = (page - 1) * limit;

    let where = "WHERE 1=1";
    const params: any[] = [];
    if (qMonth) {
      where += " AND MONTH(occurred_at)=?";
      params.push(qMonth);
    }
    if (qYear) {
      where += " AND YEAR(occurred_at)=?";
      params.push(qYear);
    }

    // count
    const [countRows]: any = await pool.query(
      `SELECT COUNT(*) as cnt FROM expenses ${where}`,
      params
    );
    const total = (countRows && countRows[0] && Number(countRows[0].cnt)) || 0;

    const [rows]: any = await pool.query(
      `SELECT * FROM expenses ${where} ORDER BY occurred_at DESC, created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const normalized = (rows || []).map(normalizeExpenseRow);
    res.json({ rows: normalized, total, page, limit });
  } catch (err: any) {
    console.error("GET /api/finance/expenses error", err);
    res.status(500).json({
      message: "Lỗi khi lấy chi phí",
      error: err?.message || String(err),
    });
  }
});

/**
 * POST /api/finance/expenses
 * body: { category, description, amount, occurred_at, created_by? }
 */
router.post(
  "/",
  requireAuth,
  requirePermission("MANAGE_EXPENSES"),
  async (req, res) => {
    const { category, description, amount, occurred_at, created_by } =
      req.body || {};
    if (!category || !amount || !occurred_at)
      return res
        .status(400)
        .json({ message: "category, amount, occurred_at required" });

    try {
      const id = uuidv4();
      const [result]: any = await pool.query(
        `INSERT INTO expenses (id, category, description, amount, occurred_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          id,
          category,
          description || null,
          Number(amount),
          occurred_at,
          created_by || null,
        ]
      );

      const inserted = {
        id,
        category,
        description,
        amount: Number(amount),
        occurred_at,
        created_by,
      };
      res.json({ success: true, expense: inserted });
    } catch (err: any) {
      console.error("POST /api/finance/expenses error", err);
      res.status(500).json({
        message: "Lỗi khi thêm chi phí",
        error: err?.message || String(err),
      });
    }
  }
);

/**
 * PUT /api/finance/expenses/:id
 * body: { category?, description?, amount?, occurred_at? }
 */
router.put(
  "/:id",
  requireAuth,
  requirePermission("MANAGE_EXPENSES"),
  async (req, res) => {
    const id = req.params.id;
    const { category, description, amount, occurred_at } = req.body || {};
    if (!category && !description && amount === undefined && !occurred_at)
      return res.status(400).json({ message: "Nothing to update" });

    try {
      let setClause = "";
      const params: any[] = [];
      if (category) {
        setClause += "category = ?, ";
        params.push(category);
      }
      if (description !== undefined) {
        setClause += "description = ?, ";
        params.push(description || null);
      }
      if (amount !== undefined) {
        setClause += "amount = ?, ";
        params.push(Number(amount));
      }
      if (occurred_at) {
        setClause += "occurred_at = ?, ";
        params.push(occurred_at);
      }
      setClause = setClause.slice(0, -2); // remove trailing ", "

      const [result]: any = await pool.query(
        `UPDATE expenses SET ${setClause} WHERE id = ?`,
        [...params, id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "Expense not found" });
      }

      const [updatedRows]: any = await pool.query(
        `SELECT * FROM expenses WHERE id = ? LIMIT 1`,
        [id]
      );
      const updated = normalizeExpenseRow(updatedRows[0]);

      res.json({ success: true, expense: updated });
    } catch (err: any) {
      console.error("PUT /api/finance/expenses/:id error", err);
      res.status(500).json({
        message: "Lỗi khi cập nhật chi phí",
        error: err?.message || String(err),
      });
    }
  }
);

/**
 * DELETE /api/finance/expenses/:id
 */
router.delete(
  "/:id",
  requireAuth,
  requirePermission("MANAGE_EXPENSES"),
  async (req, res) => {
    const id = req.params.id;
    try {
      const [result]: any = await pool.query(
        `DELETE FROM expenses WHERE id = ?`,
        [id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "Expense not found" });
      }

      res.json({ success: true });
    } catch (err: any) {
      console.error("DELETE /api/finance/expenses/:id error", err);
      res.status(500).json({
        message: "Lỗi khi xóa chi phí",
        error: err?.message || String(err),
      });
    }
  }
);

export default router;
