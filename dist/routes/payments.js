"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/payments.ts
const express_1 = __importDefault(require("express"));
const db_1 = __importDefault(require("../db"));
const uuid_1 = require("uuid");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = express_1.default.Router();
/**
 * GET /api/finance/payments
 * Query: page, limit, invoiceId, q
 * Permission: VIEW_FINANCE (or role FINANCE/ADMIN/CEO)
 */
router.get("/", auth_middleware_1.requireAuth, async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page || 1));
        const limit = Math.max(1, Number(req.query.limit || 20));
        const offset = (page - 1) * limit;
        const invoiceId = req.query.invoiceId ? String(req.query.invoiceId) : null;
        const q = (req.query.q || "").toString().trim();
        let where = "WHERE 1=1";
        const params = [];
        if (invoiceId) {
            where += " AND invoice_id = ?";
            params.push(invoiceId);
        }
        if (q) {
            where += " AND (reference LIKE ? OR method LIKE ?)";
            params.push(`%${q}%`, `%${q}%`);
        }
        // Use SQL_CALC_FOUND_ROWS then SELECT FOUND_ROWS(); keep compatibility with original approach
        const [rows] = await db_1.default.query(`SELECT SQL_CALC_FOUND_ROWS * FROM payments ${where} ORDER BY paid_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
        const [countRows] = await db_1.default.query(`SELECT FOUND_ROWS() as total`);
        const total = (countRows && countRows[0] && Number(countRows[0].total)) || 0;
        res.json({ rows, total, page, limit });
    }
    catch (err) {
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
router.post("/", auth_middleware_1.requireAuth, (0, auth_middleware_1.requireRole)(["FINANCE", "ADMIN", "CEO"]), async (req, res) => {
    let conn = null;
    try {
        const body = req.body || {};
        const id = body.id || `PAY-${(0, uuid_1.v4)()}`;
        const invoiceId = body.invoiceId || body.invoice_id;
        if (!invoiceId)
            return res.status(400).json({ message: "invoiceId là bắt buộc" });
        const amount = Number(body.amount || 0);
        if (isNaN(amount) || amount <= 0)
            return res.status(400).json({ message: "amount không hợp lệ" });
        const method = body.method || body.payMethod || null;
        const reference = body.reference || null;
        const note = body.note || null;
        const created_by = body.created_by || req.user?.id || null;
        const paid_at = body.paid_at ? new Date(body.paid_at) : new Date();
        // Try to get connection for transaction (some pool implementations may not support getConnection)
        conn = db_1.default.getConnection ? await db_1.default.getConnection() : null;
        if (conn) {
            await conn.beginTransaction();
            await conn.query("INSERT INTO payments (id, invoice_id, amount, paid_at, method, reference, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [id, invoiceId, amount, paid_at, method, reference, note, created_by]);
            // Select invoice FOR UPDATE to avoid race
            const [invRows] = await conn.query("SELECT * FROM invoices WHERE id = ? FOR UPDATE", [invoiceId]);
            if (!invRows || invRows.length === 0) {
                await conn.rollback();
                return res.status(404).json({ message: "Invoice not found" });
            }
            const invoice = invRows[0];
            const newPaid = Number(invoice.paid_amount || 0) + amount;
            const total = Number(invoice.total_amount || 0);
            let newStatus = invoice.status;
            if (newPaid >= total)
                newStatus = "PAID";
            else if (newPaid > 0)
                newStatus = "PARTIAL";
            else
                newStatus = "UNPAID";
            await conn.query("UPDATE invoices SET paid_amount = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [newPaid, newStatus, invoiceId]);
            await conn.commit();
            // fetch inserted payment for response
            const [rows] = await db_1.default.query("SELECT * FROM payments WHERE id = ?", [id]);
            return res.status(201).json((rows && rows[0]) || { id });
        }
        else {
            // fallback without explicit transaction
            await db_1.default.query("INSERT INTO payments (id, invoice_id, amount, paid_at, method, reference, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [id, invoiceId, amount, paid_at, method, reference, note, created_by]);
            const [invRows] = await db_1.default.query("SELECT * FROM invoices WHERE id = ?", [invoiceId]);
            if (!invRows || invRows.length === 0)
                return res.status(404).json({ message: "Invoice not found" });
            const invoice = invRows[0];
            const newPaid = Number(invoice.paid_amount || 0) + amount;
            const total = Number(invoice.total_amount || 0);
            let newStatus = invoice.status;
            if (newPaid >= total)
                newStatus = "PAID";
            else if (newPaid > 0)
                newStatus = "PARTIAL";
            else
                newStatus = "UNPAID";
            await db_1.default.query("UPDATE invoices SET paid_amount = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [newPaid, newStatus, invoiceId]);
            const [rows] = await db_1.default.query("SELECT * FROM payments WHERE id = ?", [id]);
            return res.status(201).json((rows && rows[0]) || { id });
        }
    }
    catch (err) {
        try {
            if (conn)
                await conn.rollback();
        }
        catch (e) {
            console.error("Rollback error", e);
        }
        console.error("POST /api/finance/payments error", err);
        res.status(500).json({ message: "Lỗi tạo payment", error: err?.message || String(err) });
    }
    finally {
        try {
            if (conn)
                conn?.release?.();
        }
        catch (e) {
            // ignore release errors
        }
    }
});
exports.default = router;
