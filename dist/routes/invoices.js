"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/invoices.ts
const express_1 = __importDefault(require("express"));
const db_1 = __importDefault(require("../db")); // adjust relative path if needed
const uuid_1 = require("uuid");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = express_1.default.Router();
/**
 * GET /api/finance/invoices
 */
router.get("/", auth_middleware_1.requireAuth, async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page || 1));
        const limit = Math.max(1, Number(req.query.limit || 20));
        const offset = (page - 1) * limit;
        const q = (req.query.q || "").toString().trim();
        const status = req.query.status ? String(req.query.status) : null;
        const studentName = req.query.studentName
            ? String(req.query.studentName)
            : null;
        const classCode = req.query.classCode ? String(req.query.classCode) : null;
        const from = req.query.from ? String(req.query.from) : null;
        const to = req.query.to ? String(req.query.to) : null;
        let where = "WHERE 1=1";
        const params = [];
        if (q) {
            // allow search by invoice_number or student name
            where +=
                " AND (invoice_number LIKE ? OR (SELECT name FROM students WHERE id = i.student_id) LIKE ?)";
            params.push(`%${q}%`, `%${q}%`);
        }
        if (status) {
            where += " AND status = ?";
            params.push(status);
        }
        if (studentName) {
            where +=
                " AND (SELECT name FROM students WHERE id = i.student_id) LIKE ?";
            params.push(`%${studentName}%`);
        }
        if (classCode) {
            where += " AND class_code = ?";
            params.push(classCode);
        }
        if (from && to) {
            where += " AND issued_date BETWEEN ? AND ?";
            params.push(from, to);
        }
        else if (from) {
            where += " AND issued_date >= ?";
            params.push(from);
        }
        else if (to) {
            where += " AND issued_date <= ?";
            params.push(to);
        }
        const [rows] = await db_1.default.query(`SELECT SQL_CALC_FOUND_ROWS i.*, (SELECT name FROM students WHERE id = i.student_id) as student_name FROM invoices i ${where} ORDER BY issued_date DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
        // safer FOUND_ROWS extraction
        const [countRows] = await db_1.default.query(`SELECT FOUND_ROWS() as total`);
        const total = (countRows && countRows[0] && Number(countRows[0].total)) || 0;
        res.json({ rows, total, page, limit });
    }
    catch (err) {
        console.error("GET /api/finance/invoices error", err);
        res.status(500).json({ message: "Lỗi server khi lấy danh sách hóa đơn" });
    }
});
/**
 * GET /api/finance/invoices/:id
 */
router.get("/:id", auth_middleware_1.requireAuth, async (req, res) => {
    try {
        const id = req.params.id;
        const [rows] = await db_1.default.query("SELECT i.*, (SELECT name FROM students WHERE id = i.student_id) as student_name FROM invoices i WHERE i.id = ?", [id]);
        if (!rows || rows.length === 0)
            return res.status(404).json({ message: "Không tìm thấy hóa đơn" });
        const invoice = rows[0];
        const [payments] = await db_1.default.query("SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at DESC", [invoice.id]);
        res.json({ invoice, payments });
    }
    catch (err) {
        console.error("GET /api/finance/invoices/:id error", err);
        res.status(500).json({ message: "Lỗi server" });
    }
});
/**
 * POST /api/finance/invoices
 * Body: { student_id?, class_code?, course_id?, total_amount, issued_date, due_date, notes?, voucher_code? }
 * If voucher_code provided, validate & apply inside transaction (server-side!)
 */
router.post("/", auth_middleware_1.requireAuth, (0, auth_middleware_1.requireRole)(["FINANCE", "ADMIN", "CEO"]), async (req, res) => {
    // Acquire connection for transaction if voucher is provided; if not, we can insert normally
    const body = req.body || {};
    const voucherCode = body.voucher_code
        ? String(body.voucher_code).trim()
        : null;
    // If voucher provided -> need transaction
    if (voucherCode) {
        const conn = await db_1.default.getConnection();
        try {
            await conn.beginTransaction();
            // compute initial fields
            const id = body.id || (0, uuid_1.v4)().replace(/-/g, "").slice(0, 32);
            const created_by = req.user?.id || "SYSTEM";
            const invoice_number = body.invoice_number ||
                `INV-${new Date().toISOString().slice(0, 7).replace("-", "")}-${(Math.floor(Math.random() * 1000) + 1)
                    .toString()
                    .padStart(3, "0")}`;
            const student_id = body.student_id || null;
            const class_code = body.class_code || null;
            const course_id = body.course_id || null;
            const total_amount_raw = Number(body.total_amount || 0);
            const issued_date = body.issued_date || new Date().toISOString().slice(0, 10);
            const due_date = body.due_date || null;
            const notes = body.notes || null;
            if (!total_amount_raw || total_amount_raw <= 0) {
                await conn.rollback();
                conn.release();
                return res.status(400).json({ message: "Tổng tiền phải lớn hơn 0" });
            }
            if (!issued_date) {
                await conn.rollback();
                conn.release();
                return res
                    .status(400)
                    .json({ message: "Ngày phát hành là bắt buộc" });
            }
            // Lock voucher row for update
            const [vRows] = await conn.query("SELECT * FROM vouchers WHERE code = ? FOR UPDATE", [voucherCode]);
            const voucher = vRows && vRows[0];
            if (!voucher || voucher.status !== "ACTIVE") {
                await conn.rollback();
                conn.release();
                return res
                    .status(400)
                    .json({ message: "Voucher không hợp lệ hoặc không hoạt động" });
            }
            const now = new Date();
            if ((voucher.valid_from && new Date(voucher.valid_from) > now) ||
                (voucher.valid_to && new Date(voucher.valid_to) < now)) {
                await conn.rollback();
                conn.release();
                return res.status(400).json({ message: "Voucher ngoài thời hạn" });
            }
            if (voucher.max_uses > 0 && voucher.used_count >= voucher.max_uses) {
                await conn.rollback();
                conn.release();
                return res
                    .status(400)
                    .json({ message: "Voucher đã hết lượt sử dụng" });
            }
            if (voucher.min_purchase &&
                total_amount_raw < Number(voucher.min_purchase)) {
                await conn.rollback();
                conn.release();
                return res
                    .status(400)
                    .json({ message: `Yêu cầu mua tối thiểu ${voucher.min_purchase}` });
            }
            if (voucher.applicable_courses) {
                let arr = [];
                try {
                    arr = JSON.parse(voucher.applicable_courses);
                }
                catch (e) {
                    arr = [];
                }
                if (Array.isArray(arr) &&
                    arr.length > 0 &&
                    course_id &&
                    !arr.includes(course_id)) {
                    await conn.rollback();
                    conn.release();
                    return res
                        .status(400)
                        .json({ message: "Voucher không áp dụng cho khóa học này" });
                }
            }
            // compute discount
            let discount = 0;
            if (voucher.discount_type === "PERCENTAGE") {
                discount = +(total_amount_raw *
                    (Number(voucher.discount_value) / 100));
            }
            else {
                discount = Number(voucher.discount_value);
            }
            if (discount > total_amount_raw)
                discount = total_amount_raw;
            const original_total = total_amount_raw;
            const new_total = +(original_total - discount);
            // insert invoice with applied voucher
            const paid_amount = 0;
            const status = "UNPAID";
            await conn.query("INSERT INTO invoices (id, invoice_number, student_id, class_code, course_id, total_amount, original_total, discount_amount, paid_amount, status, issued_date, due_date, notes, created_by, voucher_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                id,
                invoice_number,
                student_id,
                class_code,
                course_id,
                new_total,
                original_total,
                discount,
                paid_amount,
                status,
                issued_date,
                due_date,
                notes,
                created_by,
                voucherCode,
            ]);
            // increment voucher used_count
            const newUsed = Number(voucher.used_count || 0) + 1;
            await conn.query("UPDATE vouchers SET used_count = ? WHERE id = ?", [
                newUsed,
                voucher.id,
            ]);
            await conn.commit();
            // fetch created invoice for return
            const [rows] = await db_1.default.query("SELECT i.*, (SELECT name FROM students WHERE id = i.student_id) as student_name FROM invoices i WHERE i.id = ?", [id]);
            conn.release();
            return res.status(201).json((rows && rows[0]) || null);
        }
        catch (err) {
            console.error("POST /api/finance/invoices (with voucher) error", err);
            try {
                await db_1.default.rollback();
            }
            catch (e) { }
            try {
                await db_1.default.release();
            }
            catch (e) { }
            return res
                .status(500)
                .json({ message: "Lỗi tạo hóa đơn với voucher", error: err.message });
        }
    }
    // If no voucher provided -> normal insert (existing logic)
    try {
        const id = body.id || (0, uuid_1.v4)().replace(/-/g, "").slice(0, 32);
        const created_by = req.user?.id || "SYSTEM";
        const invoice_number = body.invoice_number ||
            `INV-${new Date().toISOString().slice(0, 7).replace("-", "")}-${(Math.floor(Math.random() * 1000) + 1)
                .toString()
                .padStart(3, "0")}`;
        const student_id = body.student_id || null;
        const class_code = body.class_code || null;
        const course_id = body.course_id || null;
        const total_amount = Number(body.total_amount || 0);
        const paid_amount = 0; // Default 0
        const status = "UNPAID"; // Default UNPAID
        const issued_date = body.issued_date || new Date().toISOString().slice(0, 10);
        const due_date = body.due_date || null;
        const notes = body.notes || null;
        if (!total_amount || total_amount <= 0) {
            return res.status(400).json({ message: "Tổng tiền phải lớn hơn 0" });
        }
        if (!issued_date) {
            return res.status(400).json({ message: "Ngày phát hành là bắt buộc" });
        }
        await db_1.default.query("INSERT INTO invoices (id, invoice_number, student_id, class_code, course_id, total_amount, paid_amount, status, issued_date, due_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
            id,
            invoice_number,
            student_id,
            class_code,
            course_id,
            total_amount,
            paid_amount,
            status,
            issued_date,
            due_date,
            notes,
            created_by,
        ]);
        const [rows] = await db_1.default.query("SELECT i.*, (SELECT name FROM students WHERE id = i.student_id) as student_name FROM invoices i WHERE i.id = ?", [id]);
        res.status(201).json((rows && rows[0]) || null);
    }
    catch (err) {
        console.error("POST /api/finance/invoices error", err);
        res.status(500).json({ message: "Lỗi tạo hóa đơn", error: err.message });
    }
});
/**
 * PUT /api/finance/invoices/:id
 * Update editable fields
 */
router.put("/:id", auth_middleware_1.requireAuth, (0, auth_middleware_1.requireRole)(["FINANCE", "ADMIN", "CEO"]), async (req, res) => {
    try {
        const id = req.params.id;
        const body = req.body || {};
        const fields = [
            "student_id",
            "class_code",
            "course_id",
            "total_amount",
            "due_date",
            "notes",
        ];
        const updates = [];
        const params = [];
        fields.forEach((f) => {
            if (body[f] !== undefined) {
                if (f === "total_amount") {
                    const amount = Number(body[f]);
                    if (isNaN(amount) || amount <= 0) {
                        throw new Error("Tổng tiền phải là số lớn hơn 0");
                    }
                    params.push(amount);
                }
                else if (f === "due_date") {
                    const date = body[f]
                        ? new Date(body[f]).toISOString().slice(0, 10)
                        : null;
                    params.push(date);
                }
                else {
                    params.push(body[f]);
                }
                updates.push(`${f} = ?`);
            }
        });
        if (updates.length === 0)
            return res.status(400).json({ message: "Không có trường để cập nhật" });
        params.push(id);
        const sql = `UPDATE invoices SET ${updates.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
        const [result] = await db_1.default.query(sql, params);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Không tìm thấy hóa đơn" });
        }
        const [rows] = await db_1.default.query("SELECT i.*, (SELECT name FROM students WHERE id = i.student_id) as student_name FROM invoices i WHERE i.id = ?", [id]);
        res.json((rows && rows[0]) || null);
    }
    catch (err) {
        console.error("PUT /api/finance/invoices/:id error", err);
        res
            .status(500)
            .json({ message: "Lỗi cập nhật hóa đơn", error: err.message });
    }
});
/**
 * POST /api/finance/invoices/:id/apply-voucher
 * Body: { code }
 * Apply voucher to an existing invoice (transactional)
 */
router.post("/:id/apply-voucher", auth_middleware_1.requireAuth, (0, auth_middleware_1.requireRole)(["FINANCE", "ADMIN", "CEO"]), async (req, res) => {
    const invoiceId = req.params.id;
    const { code } = req.body || {};
    if (!code)
        return res.status(400).json({ message: "Mã voucher bắt buộc" });
    const conn = await db_1.default.getConnection();
    try {
        await conn.beginTransaction();
        const [invRows] = await conn.query("SELECT * FROM invoices WHERE id = ? FOR UPDATE", [invoiceId]);
        const invoice = invRows && invRows[0];
        if (!invoice) {
            await conn.rollback();
            conn.release();
            return res.status(404).json({ message: "Không tìm thấy hóa đơn" });
        }
        const [vRows] = await conn.query("SELECT * FROM vouchers WHERE code = ? FOR UPDATE", [code]);
        const voucher = vRows && vRows[0];
        if (!voucher || voucher.status !== "ACTIVE") {
            await conn.rollback();
            conn.release();
            return res.status(400).json({ message: "Voucher không hợp lệ" });
        }
        const now = new Date();
        if ((voucher.valid_from && new Date(voucher.valid_from) > now) ||
            (voucher.valid_to && new Date(voucher.valid_to) < now)) {
            await conn.rollback();
            conn.release();
            return res.status(400).json({ message: "Voucher ngoài thời hạn" });
        }
        if (voucher.max_uses > 0 && voucher.used_count >= voucher.max_uses) {
            await conn.rollback();
            conn.release();
            return res.status(400).json({ message: "Voucher đã hết lượt sử dụng" });
        }
        const invoiceTotal = Number(invoice.total_amount || 0);
        if (voucher.min_purchase && invoiceTotal < Number(voucher.min_purchase)) {
            await conn.rollback();
            conn.release();
            return res
                .status(400)
                .json({ message: `Yêu cầu mua tối thiểu ${voucher.min_purchase}` });
        }
        if (voucher.applicable_courses) {
            let arr = [];
            try {
                arr = JSON.parse(voucher.applicable_courses);
            }
            catch (e) {
                arr = [];
            }
            if (Array.isArray(arr) &&
                arr.length > 0 &&
                invoice.course_id &&
                !arr.includes(invoice.course_id)) {
                await conn.rollback();
                conn.release();
                return res
                    .status(400)
                    .json({ message: "Voucher không áp dụng cho khóa học này" });
            }
        }
        let discount = 0;
        if (voucher.discount_type === "PERCENTAGE") {
            discount = +(invoiceTotal * (Number(voucher.discount_value) / 100));
        }
        else {
            discount = Number(voucher.discount_value);
        }
        if (discount > invoiceTotal)
            discount = invoiceTotal;
        const original_total = invoice.original_total ?? invoiceTotal;
        const new_total = +(original_total - discount);
        await conn.query(`UPDATE invoices SET voucher_code = ?, discount_amount = ?, original_total = ?, total_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [voucher.code, discount, original_total, new_total, invoiceId]);
        const newUsed = Number(voucher.used_count || 0) + 1;
        await conn.query("UPDATE vouchers SET used_count = ? WHERE id = ?", [
            newUsed,
            voucher.id,
        ]);
        await conn.commit();
        conn.release();
        const [updatedRows] = await db_1.default.query("SELECT i.*, (SELECT name FROM students WHERE id = i.student_id) as student_name FROM invoices i WHERE i.id = ?", [invoiceId]);
        return res.json({
            success: true,
            invoice: updatedRows && updatedRows[0],
            discount_amount: discount,
        });
    }
    catch (err) {
        console.error("POST /api/finance/invoices/:id/apply-voucher error", err);
        try {
            await conn.rollback();
        }
        catch (e) { }
        try {
            conn.release();
        }
        catch (e) { }
        return res
            .status(500)
            .json({ message: "Lỗi khi áp dụng voucher", error: err.message });
    }
});
/**
 * POST /api/finance/invoices/:id/payments
 * Create a payment tied to this invoice and update invoice.paid_amount & status (transactional)
 * Body: { amount, method, reference, note, created_by, paid_at? }
 */
router.post("/:id/payments", auth_middleware_1.requireAuth, (0, auth_middleware_1.requireRole)(["FINANCE", "ADMIN", "CEO"]), async (req, res) => {
    const invoiceId = req.params.id;
    const body = req.body || {};
    const amount = Number(body.amount || 0);
    if (!amount || amount <= 0) {
        return res.status(400).json({ message: "Amount phải lớn hơn 0" });
    }
    const conn = await db_1.default.getConnection();
    try {
        await conn.beginTransaction();
        // ensure invoice exists and lock
        const [invRows] = await conn.query("SELECT * FROM invoices WHERE id = ? FOR UPDATE", [invoiceId]);
        if (!invRows || invRows.length === 0) {
            await conn.rollback();
            conn.release();
            return res.status(404).json({ message: "Invoice not found" });
        }
        const invoice = invRows[0];
        const paymentId = body.id || `PAY-${(0, uuid_1.v4)()}`;
        const method = body.method || body.payMethod || null;
        const reference = body.reference || null;
        const note = body.note || null;
        const created_by = body.created_by || req.user?.id || null;
        const paid_at = body.paid_at || new Date();
        await conn.query("INSERT INTO payments (id, invoice_id, amount, paid_at, method, reference, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
            paymentId,
            invoiceId,
            amount,
            paid_at,
            method,
            reference,
            note,
            created_by,
        ]);
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
        // fetch payment and invoice to return
        const [rows] = await db_1.default.query("SELECT * FROM payments WHERE id = ?", [paymentId]);
        const [invUpdatedRows] = await db_1.default.query("SELECT i.*, (SELECT name FROM students WHERE id = i.student_id) as student_name FROM invoices i WHERE i.id = ?", [invoiceId]);
        conn.release();
        return res.status(201).json({
            payment: rows && rows[0],
            invoice: invUpdatedRows && invUpdatedRows[0],
        });
    }
    catch (err) {
        console.error("POST /api/finance/invoices/:id/payments error", err);
        try {
            await conn.rollback();
        }
        catch (e) { }
        try {
            conn.release();
        }
        catch (e) { }
        return res
            .status(500)
            .json({ message: "Lỗi tạo payment cho hóa đơn", error: err.message });
    }
});
/**
 * POST /api/finance/invoices/:id/remind
 * Body: { reminder_type?, channel?, details? }
 * - Tries to create invoice_reminder_logs table (without FK) if missing.
 * - Inserts a reminder log. If create/insert fails (permissions/db issues),
 *   fallback: create an in-app notification in notifications table (safer, exists).
 */
router.post("/:id/remind", auth_middleware_1.requireAuth, (0, auth_middleware_1.requireRole)(["FINANCE", "ADMIN", "CEO"]), async (req, res) => {
    const invoiceId = req.params.id;
    const { reminder_type, channel, details } = req.body || {};
    const rType = reminder_type || "MANUAL";
    const ch = channel || "EMAIL";
    const dt = details ? JSON.stringify(details) : null;
    try {
        // 1) Ensure invoice exists
        const [invRows] = await db_1.default.query("SELECT id, invoice_number, student_id, total_amount, paid_amount, status FROM invoices WHERE id = ?", [invoiceId]);
        if (!invRows || invRows.length === 0) {
            return res.status(404).json({ message: "Invoice not found" });
        }
        const invoice = invRows[0];
        // 2) Try to create reminder table IF NOT EXISTS (without foreign key to avoid FK mismatch issues)
        // This is idempotent and should be safe in most setups.
        try {
            await db_1.default.query(`CREATE TABLE IF NOT EXISTS invoice_reminder_logs (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            invoice_id VARCHAR(64) NOT NULL,
            reminder_type ENUM('DAYS_7','DAYS_3','DAYS_1','OVERDUE','MANUAL') NOT NULL DEFAULT 'MANUAL',
            sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            channel ENUM('EMAIL','SMS','INAPP','MANUAL') NOT NULL DEFAULT 'EMAIL',
            details TEXT NULL,
            INDEX (invoice_id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);
        }
        catch (createErr) {
            // Not fatal — we'll fallback to notifications below if insert also fails.
            console.warn("[invoices.remind] CREATE TABLE invoice_reminder_logs failed, will fallback to notifications. Error:", typeof createErr === "object" && createErr !== null && "message" in createErr
                ? createErr.message
                : String(createErr));
        }
        // 3) Try to insert into invoice_reminder_logs
        try {
            const insertSql = "INSERT INTO invoice_reminder_logs (invoice_id, reminder_type, channel, details, sent_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)";
            const [result] = await db_1.default.query(insertSql, [
                invoiceId,
                rType,
                ch,
                dt,
            ]);
            return res.json({
                success: true,
                message: "Reminder logged",
                reminderId: (result && result.insertId) || null,
            });
        }
        catch (insertErr) {
            // Insert failed (maybe table not creatable / permissions), fallback to notifications
            console.warn("[invoices.remind] insert into invoice_reminder_logs failed, fallback to notifications. Error:", typeof insertErr === "object" && insertErr !== null && "message" in insertErr
                ? insertErr.message
                : String(insertErr));
        }
        // 4) FALLBACK: insert into notifications table (should exist per your schema)
        try {
            const notifTitle = `Nhắc nợ HĐ ${invoice.invoice_number || invoice.id}`;
            const notifBody = `Nhắc ${rType} - kênh ${ch} - Hóa đơn: ${invoice.invoice_number || invoice.id} - Số tiền: ${invoice.total_amount || 0}`;
            const metaObj = {
                invoiceId: invoice.id,
                reminder_type: rType,
                channel: ch,
                details: details || null,
            };
            const [notifRes] = await db_1.default.query("INSERT INTO notifications (user_id, type, title, body, meta, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)", [
                invoice.student_id || null,
                "REMINDER",
                notifTitle,
                notifBody,
                JSON.stringify(metaObj),
            ]);
            return res.json({
                success: true,
                message: "Reminder logged via notifications fallback",
                notificationId: (notifRes && notifRes.insertId) || null,
            });
        }
        catch (notifErr) {
            console.error("[invoices.remind] fallback to notifications failed:", notifErr);
            return res
                .status(500)
                .json({
                message: "Lỗi khi tạo reminder",
                error: typeof notifErr === 'object' && notifErr !== null && 'message' in notifErr ? notifErr.message : String(notifErr),
            });
        }
    }
    catch (err) {
        console.error("POST /api/finance/invoices/:id/remind error:", err);
        return res
            .status(500)
            .json({
            message: "Lỗi khi tạo reminder",
            error: err?.message || String(err),
        });
    }
});
/**
 * DELETE /api/finance/invoices/:id
 * Soft delete by setting status to CANCELLED
 */
router.delete("/:id", auth_middleware_1.requireAuth, (0, auth_middleware_1.requireRole)(["FINANCE", "ADMIN", "CEO"]), async (req, res) => {
    try {
        const id = req.params.id;
        const [result] = await db_1.default.query("UPDATE invoices SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Không tìm thấy hóa đơn" });
        }
        res.json({ success: true });
    }
    catch (err) {
        console.error("DELETE /api/finance/invoices/:id error", err);
        res.status(500).json({ message: "Lỗi xóa hóa đơn" });
    }
});
exports.default = router;
