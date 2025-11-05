// src/routes/offers.ts
import { Router, Request, Response } from "express";
import pool from "../db";
import { authenticateToken, requirePermission } from "../middlewares/auth.middleware"; // path consistent with middleware file
// Note: using authenticateToken alias (verifyToken) to accept Bearer + dev header flow

interface CustomRequest extends Request {
  user?: { id: string };
}

const router = Router();

// GET /api/admissions/offers - Lấy danh sách vouchers
router.get("/", authenticateToken, requirePermission("VIEW_CRM"), async (req: CustomRequest, res: Response) => {
  try {
    const { search, status, page = "1", limit = "20" } = req.query as { search?: string; status?: string; page?: string; limit?: string };
    let query = `
      SELECT v.*, 
             e.name as created_by_name,
             JSON_LENGTH(v.applicable_courses) as course_count
      FROM vouchers v 
      LEFT JOIN employees e ON v.created_by = e.id
      WHERE v.status != 'DELETED'
    `;
    const params: (string | number)[] = [];

    if (search) {
      query += ` AND (v.code LIKE ? OR v.description LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }
    if (status && status !== "ALL") {
      query += ` AND v.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY v.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    // Using `any` typing for query result to avoid TS indexing complaints
    const [vouchers]: any = await pool.query(query, params);

    // Build count query: reuse where clause by stripping ORDER/LIMIT/OFFSET
    // Safer to compute count separately using same where conditions
    let countQuery = `
      SELECT COUNT(*) as total
      FROM vouchers v
      WHERE v.status != 'DELETED'
    `;
    const countParams: (string | number)[] = [];
    if (search) {
      countQuery += ` AND (v.code LIKE ? OR v.description LIKE ?)`;
      countParams.push(`%${search}%`, `%${search}%`);
    }
    if (status && status !== "ALL") {
      countQuery += ` AND v.status = ?`;
      countParams.push(status);
    }

    const [countResult]: any = await pool.query(countQuery, countParams);

    res.json({
      data: vouchers,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: (countResult && countResult[0] && countResult[0].total) ? Number(countResult[0].total) : 0 }
    });
  } catch (error) {
    console.error("Error fetching vouchers:", error);
    res.status(500).json({ error: "Lỗi server" });
  }
});

// POST /api/admissions/offers - Tạo voucher mới
router.post("/", authenticateToken, requirePermission("EDIT_CRM"), async (req: CustomRequest, res: Response) => {
  try {
    const { code, description, discount_type, discount_value, min_purchase, max_uses, valid_from, valid_to, applicable_courses } = req.body;
    const created_by = req.user?.id;

    const query = `
      INSERT INTO vouchers (id, code, description, discount_type, discount_value, min_purchase, max_uses, valid_from, valid_to, applicable_courses, created_by, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
    `;
    const params = [
      `VOU-${Date.now()}`, code, description, discount_type, discount_value, min_purchase || 0, max_uses || 0, valid_from, valid_to,
      applicable_courses ? JSON.stringify(applicable_courses) : null, created_by
    ];

    const [result]: any = await pool.query(query, params);

    res.status(201).json({ message: "Tạo voucher thành công", id: result.insertId || params[0] });
  } catch (error) {
    console.error("Error creating voucher:", error);
    res.status(500).json({ error: "Lỗi tạo voucher" });
  }
});

// PUT /api/admissions/offers/:id - Cập nhật voucher
router.put("/:id", authenticateToken, requirePermission("EDIT_CRM"), async (req: CustomRequest, res: Response) => {
  try {
    const { id } = req.params;
    const fields = { ...req.body };
    fields.updated_at = new Date();

    // Ensure fields not empty
    const keys = Object.keys(fields);
    if (keys.length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    const setClause = keys.map(key => `${key} = ?`).join(", ");
    const values = [...keys.map(k => (fields as any)[k]), id];

    await pool.query(`UPDATE vouchers SET ${setClause} WHERE id = ?`, values);
    res.json({ message: "Cập nhật voucher thành công" });
  } catch (error) {
    console.error("Error updating voucher:", error);
    res.status(500).json({ error: "Lỗi cập nhật" });
  }
});

// DELETE /api/admissions/offers/:id - Soft delete
router.delete("/:id", authenticateToken, requirePermission("EDIT_CRM"), async (req: CustomRequest, res: Response) => {
  try {
    const { id } = req.params;
    await pool.query(`UPDATE vouchers SET status = 'DELETED' WHERE id = ?`, [id]);
    res.json({ message: "Xóa voucher thành công" });
  } catch (error) {
    console.error("Error deleting voucher:", error);
    res.status(500).json({ error: "Lỗi xóa" });
  }
});

export default router;
