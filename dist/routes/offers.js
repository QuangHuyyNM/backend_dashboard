"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/offers.ts
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const auth_middleware_1 = require("../middlewares/auth.middleware"); // path consistent with middleware file
const router = (0, express_1.Router)();
// GET /api/admissions/offers - Lấy danh sách vouchers
router.get("/", auth_middleware_1.authenticateToken, (0, auth_middleware_1.requirePermission)("VIEW_CRM"), async (req, res) => {
    try {
        const { search, status, page = "1", limit = "20" } = req.query;
        let query = `
      SELECT v.*, 
             e.name as created_by_name,
             JSON_LENGTH(v.applicable_courses) as course_count
      FROM vouchers v 
      LEFT JOIN employees e ON v.created_by = e.id
      WHERE v.status != 'DELETED'
    `;
        const params = [];
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
        const [vouchers] = await db_1.default.query(query, params);
        // Build count query: reuse where clause by stripping ORDER/LIMIT/OFFSET
        // Safer to compute count separately using same where conditions
        let countQuery = `
      SELECT COUNT(*) as total
      FROM vouchers v
      WHERE v.status != 'DELETED'
    `;
        const countParams = [];
        if (search) {
            countQuery += ` AND (v.code LIKE ? OR v.description LIKE ?)`;
            countParams.push(`%${search}%`, `%${search}%`);
        }
        if (status && status !== "ALL") {
            countQuery += ` AND v.status = ?`;
            countParams.push(status);
        }
        const [countResult] = await db_1.default.query(countQuery, countParams);
        res.json({
            data: vouchers,
            pagination: { page: parseInt(page), limit: parseInt(limit), total: (countResult && countResult[0] && countResult[0].total) ? Number(countResult[0].total) : 0 }
        });
    }
    catch (error) {
        console.error("Error fetching vouchers:", error);
        res.status(500).json({ error: "Lỗi server" });
    }
});
// POST /api/admissions/offers - Tạo voucher mới
router.post("/", auth_middleware_1.authenticateToken, (0, auth_middleware_1.requirePermission)("EDIT_CRM"), async (req, res) => {
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
        const [result] = await db_1.default.query(query, params);
        res.status(201).json({ message: "Tạo voucher thành công", id: result.insertId || params[0] });
    }
    catch (error) {
        console.error("Error creating voucher:", error);
        res.status(500).json({ error: "Lỗi tạo voucher" });
    }
});
// PUT /api/admissions/offers/:id - Cập nhật voucher
router.put("/:id", auth_middleware_1.authenticateToken, (0, auth_middleware_1.requirePermission)("EDIT_CRM"), async (req, res) => {
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
        const values = [...keys.map(k => fields[k]), id];
        await db_1.default.query(`UPDATE vouchers SET ${setClause} WHERE id = ?`, values);
        res.json({ message: "Cập nhật voucher thành công" });
    }
    catch (error) {
        console.error("Error updating voucher:", error);
        res.status(500).json({ error: "Lỗi cập nhật" });
    }
});
// DELETE /api/admissions/offers/:id - Soft delete
router.delete("/:id", auth_middleware_1.authenticateToken, (0, auth_middleware_1.requirePermission)("EDIT_CRM"), async (req, res) => {
    try {
        const { id } = req.params;
        await db_1.default.query(`UPDATE vouchers SET status = 'DELETED' WHERE id = ?`, [id]);
        res.json({ message: "Xóa voucher thành công" });
    }
    catch (error) {
        console.error("Error deleting voucher:", error);
        res.status(500).json({ error: "Lỗi xóa" });
    }
});
exports.default = router;
