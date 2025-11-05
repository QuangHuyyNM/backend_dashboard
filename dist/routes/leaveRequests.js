"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/leaveRequests.ts
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const uuid = __importStar(require("uuid")); // import kiểu này tương thích CommonJS và ESM
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
// Không cần khai báo biến id ở đây, tạo id trong hàm POST
/**
 * GET /api/leave-requests
 * Optional query params: status, employee_id
 * Returns leave requests joined with employee name/role
 */
router.get("/", auth_middleware_1.requireAuth, async (req, res) => {
    try {
        const { status, employee_id } = req.query;
        const where = [];
        const params = [];
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
        const [rows] = await db_1.default.query(sql, params);
        res.json(rows);
    }
    catch (err) {
        console.error("leave-requests GET / error:", err);
        res.status(500).json({ message: "DB error" });
    }
});
/**
 * POST /api/leave-requests
 * Body: { id?, employee_id, leave_type?, start_date, end_date, reason? }
 * - If id not provided, generate uuid
 */
router.post("/", auth_middleware_1.requireAuth, async (req, res) => {
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
        await db_1.default.query(sql, [id, employee_id, leave_type || null, start_date, end_date, reason || null]);
        const [rows] = await db_1.default.query(`SELECT lr.*, e.name AS employeeName, e.role AS employeeRole
       FROM leave_requests lr
       LEFT JOIN employees e ON lr.employee_id = e.id
       WHERE lr.id = ?`, [id]);
        res.status(201).json(rows[0]);
    }
    catch (err) {
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
router.put("/:id", auth_middleware_1.requireAuth, (0, auth_middleware_1.requireRole)(["HR", "CEO"]), async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body || {};
        const allowed = new Set(["Đã duyệt", "Bị từ chối", "Chờ duyệt"]);
        if (!status || !allowed.has(status)) {
            return res.status(400).json({ message: "Trạng thái không hợp lệ. Dùng: 'Chờ duyệt'|'Đã duyệt'|'Bị từ chối'." });
        }
        // Update
        await db_1.default.query("UPDATE leave_requests SET status = ? WHERE id = ?", [status, id]);
        // Return updated row joined with employee info
        const [rows] = await db_1.default.query(`SELECT lr.*, e.name AS employeeName, e.role AS employeeRole
       FROM leave_requests lr
       LEFT JOIN employees e ON lr.employee_id = e.id
       WHERE lr.id = ?`, [id]);
        const updated = rows[0];
        // Optional: insert a notification for the employee (if notifications table exists)
        try {
            await db_1.default.query(`INSERT INTO notifications (user_id, type, title, body, meta, is_read, created_at)
         VALUES (?, 'LEAVE', ?, ?, ?, 0, NOW())`, [
                updated?.employee_id || null,
                `Đơn nghỉ của bạn đã được cập nhật`,
                `Đơn nghỉ (${id}) đã chuyển thành: ${status}`,
                JSON.stringify({ leaveRequestId: id })
            ]);
        }
        catch (notifErr) {
            // not critical — log and continue
            console.warn("Không thể tạo notification (không ảnh hưởng tới thao tác):", notifErr);
        }
        res.json(updated);
    }
    catch (err) {
        console.error("leave-requests PUT /:id error:", err);
        res.status(500).json({ message: "Update error" });
    }
});
/**
 * DELETE /api/leave-requests/:id
 * (optional) — keep for completeness, only HR/CEO can delete
 */
router.delete("/:id", auth_middleware_1.requireAuth, (0, auth_middleware_1.requireRole)(["HR", "CEO"]), async (req, res) => {
    try {
        await db_1.default.query("DELETE FROM leave_requests WHERE id = ?", [req.params.id]);
        res.json({ ok: true });
    }
    catch (err) {
        console.error("leave-requests DELETE /:id error:", err);
        res.status(500).json({ message: "Delete error" });
    }
});
exports.default = router;
