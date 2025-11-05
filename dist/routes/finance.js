"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/finance.ts
const express_1 = __importDefault(require("express"));
const db_1 = __importDefault(require("../db"));
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = express_1.default.Router();
// --- TỔNG QUAN ---
router.get("/overview", auth_middleware_1.requireAuth, async (req, res) => {
    try {
        const monthQuery = req.query.month || new Date().toISOString().slice(0, 7);
        const [year, month] = monthQuery.split("-").map(Number);
        // ✅ FIX: Xử lý kết quả query một cách an toàn
        const [kpiRevenueRows] = await db_1.default.query("SELECT SUM(total_amount) as total FROM invoices WHERE YEAR(issued_date) = ? AND MONTH(issued_date) = ?", [year, month]);
        const kpiRevenue = kpiRevenueRows[0];
        const [kpiCollectedRows] = await db_1.default.query("SELECT SUM(amount) as total FROM payments WHERE YEAR(paid_at) = ? AND MONTH(paid_at) = ?", [year, month]);
        const kpiCollected = kpiCollectedRows[0];
        const [kpiExpensesRows] = await db_1.default.query("SELECT SUM(amount) as total FROM expenses WHERE YEAR(occurred_at) = ? AND MONTH(occurred_at) = ?", [year, month]);
        const kpiExpenses = kpiExpensesRows[0];
        const [kpiPayrollRows] = await db_1.default.query("SELECT SUM(total_pay) as total FROM payslips WHERE year = ? AND month = ?", [year, month]);
        const kpiPayroll = kpiPayrollRows[0];
        const [kpiReceivablesRows] = await db_1.default.query("SELECT SUM(total_amount - paid_amount) as total FROM invoices WHERE status NOT IN ('PAID', 'CANCELLED')");
        const kpiReceivables = kpiReceivablesRows[0];
        const revenueThisMonth = parseFloat(kpiRevenue.total || 0);
        const expensesThisMonth = parseFloat(kpiExpenses.total || 0);
        const payrollThisMonth = parseFloat(kpiPayroll.total || 0);
        const profitLossThisMonth = revenueThisMonth - (expensesThisMonth + payrollThisMonth);
        const [topUnpaid] = await db_1.default.query(`SELECT i.*, s.name as student_name 
       FROM invoices i
       LEFT JOIN students s ON i.student_id = s.id
       WHERE i.status IN ('UNPAID', 'PARTIAL', 'OVERDUE') 
       ORDER BY (i.total_amount - i.paid_amount) DESC LIMIT 5`);
        res.json({
            meta: { year, month },
            kpis: {
                revenueThisMonth,
                collectedThisMonth: parseFloat(kpiCollected.total || 0),
                receivables: parseFloat(kpiReceivables.total || 0),
                expensesThisMonth,
                payrollThisMonth,
                profitLossThisMonth,
            },
            series: { /* Dữ liệu biểu đồ có thể được thêm ở đây */},
            topUnpaid: topUnpaid || [],
        });
    }
    catch (err) {
        console.error("GET /api/finance/overview error", err);
        res.status(500).json({ message: "Lỗi khi tạo báo cáo tổng quan tài chính" });
    }
});
router.delete("/invoices/:id", auth_middleware_1.requireAuth, (0, auth_middleware_1.requireRole)(['CEO', 'FINANCE']), async (req, res) => {
    try {
        const { id } = req.params;
        const [result] = await db_1.default.query("DELETE FROM invoices WHERE id = ?", [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Không tìm thấy hóa đơn để xóa." });
        }
        // Trả về 204 No Content khi thành công
        res.status(204).send();
    }
    catch (err) {
        console.error(`DELETE /api/finance/invoices/${req.params.id} error:`, err);
        res.status(500).json({ message: "Lỗi khi xóa hóa đơn", error: err.message });
    }
});
// --- HÓA ĐƠN (INVOICES) ---
router.get("/invoices", auth_middleware_1.requireAuth, async (req, res) => {
    const [rows] = await db_1.default.query(`
    SELECT i.*, s.name as student_name 
    FROM invoices i 
    LEFT JOIN students s ON i.student_id = s.id 
    ORDER BY i.issued_date DESC
  `);
    res.json({ rows });
});
// ✅ MỚI: API LẤY CHI TIẾT MỘT HÓA ĐƠN
router.get("/invoices/:id", auth_middleware_1.requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const [invoiceRows] = await db_1.default.query(`
            SELECT i.*, s.name as student_name 
            FROM invoices i 
            LEFT JOIN students s ON i.student_id = s.id 
            WHERE i.id = ?
        `, [id]);
        if (invoiceRows.length === 0) {
            return res.status(404).json({ message: "Không tìm thấy hóa đơn." });
        }
        const invoice = invoiceRows[0];
        const [payments] = await db_1.default.query("SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at DESC", [id]);
        res.json({ ...invoice, payments });
    }
    catch (err) {
        console.error(`GET /api/finance/invoices/${req.params.id} error`, err);
        res.status(500).json({ message: "Lỗi khi lấy chi tiết hóa đơn" });
    }
});
// --- CÁC ROUTE KHÁC ---
router.get("/expenses", auth_middleware_1.requireAuth, async (req, res) => {
    const [rows] = await db_1.default.query("SELECT * FROM expenses ORDER BY occurred_at DESC");
    res.json({ rows });
});
router.get("/payslips", auth_middleware_1.requireAuth, async (req, res) => {
    const [rows] = await db_1.default.query(`
    SELECT p.*, e.name as employee_name
    FROM payslips p
    LEFT JOIN employees e ON p.employee_id = e.id
    ORDER BY p.year DESC, p.month DESC
  `);
    res.json({ rows });
});
router.get("/payments", auth_middleware_1.requireAuth, async (req, res) => {
    const [rows] = await db_1.default.query("SELECT * FROM payments ORDER BY paid_at DESC");
    res.json({ rows });
});
router.get("/ar", auth_middleware_1.requireAuth, async (req, res) => {
    const [rows] = await db_1.default.query(`
    SELECT i.*, s.name as student_name 
    FROM invoices i 
    LEFT JOIN students s ON i.student_id = s.id 
    WHERE i.status IN ('UNPAID', 'PARTIAL', 'OVERDUE')
    ORDER BY i.due_date ASC
  `);
    res.json({ rows });
});
exports.default = router;
